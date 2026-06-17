/**
 * FocusGuard — Background Service Worker (ES Module)
 * 
 * Responsibilities:
 * - Session lifecycle management (init on startup, cleanup)
 * - Message routing between popup/content scripts
 * - Goal inference from recent browsing activity
 * - Break timer management via chrome.alarms
 * - SPA navigation detection via webNavigation API
 */

import {
  MSG, STORAGE_KEYS, SITE, PAGE_TYPE,
  INFERENCE_KEYWORDS, SEARCH_QUERY_PARAMS, REMINDERS, DEFAULT_SETTINGS,
} from '../lib/constants.js';

import {
  getSession, setSession, updateSession, createDefaultSession,
  getTodos, addTodo, toggleTodo, deleteTodo, clearCompletedTodos,
  getSettings, updateSettings,
  getRecentUrls, addRecentUrl, clearRecentUrls,
} from '../lib/storage.js';

const api = (typeof browser !== 'undefined') ? browser : chrome;

// ============================================================
//  SESSION LIFECYCLE
// ============================================================

async function initSession() {
  const session = createDefaultSession();
  await setSession(session);
  await clearCompletedTodos();
  await clearRecentUrls();
  console.log('[FocusGuard] New session initialized');
}

// Browser launched → new session
api.runtime.onStartup.addListener(() => {
  initSession();
});

// Extension installed or updated
api.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    api.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    console.log('[FocusGuard] Installed — default settings saved');
  }
  initSession();
});

// ============================================================
//  TAB URL TRACKING (for goal inference, opt-in)
// ============================================================

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.url || !tab.url.startsWith('http')) return;

  try {
    const settings = await getSettings();
    if (settings.goalInferenceEnabled) {
      await addRecentUrl(tab.url, tab.title || '');
    }
  } catch (e) {
    // Ignore errors during URL tracking
  }
});

// ============================================================
//  SPA NAVIGATION DETECTION (webNavigation → content scripts)
// ============================================================

const NAV_FILTER = {
  url: [
    { hostSuffix: 'youtube.com' },
    { hostSuffix: 'instagram.com' },
  ],
};

// Fires on pushState / replaceState (SPA navigation)
api.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return; // Main frame only
  safeSendToTab(details.tabId, { type: MSG.URL_CHANGED, url: details.url });
}, NAV_FILTER);

// Fires on full page load completion
api.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  safeSendToTab(details.tabId, { type: MSG.URL_CHANGED, url: details.url });
}, NAV_FILTER);

// Hash-based routing changes
api.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  safeSendToTab(details.tabId, { type: MSG.URL_CHANGED, url: details.url });
}, NAV_FILTER);

/** Safely send a message to a tab's content script (swallows errors) */
function safeSendToTab(tabId, message) {
  api.tabs.sendMessage(tabId, message).catch(() => {
    // Content script might not be loaded yet — that's fine
  });
}

/**
 * Broadcast to all YouTube/Instagram tabs to re-evaluate their blocking state.
 * Reuses the BREAK_ENDED message since it already triggers a full re-check
 * in content-common.js (URL change callbacks fire for the current URL).
 */
async function notifyTabsToRecheck() {
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('instagram.com'))) {
      safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
    }
  }
}

// ============================================================
//  GOAL INFERENCE ENGINE
// ============================================================

/**
 * Extracts the search query string from a URL, if the URL is from a known
 * search engine. Returns null if the URL is not a recognized search page.
 * This is O(number of known engines) — effectively O(1).
 */
function _extractSearchQuery(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    for (const [engineHost, param] of Object.entries(SEARCH_QUERY_PARAMS)) {
      if (hostname === engineHost || hostname.endsWith('.' + engineHost)) {
        const query = parsed.searchParams.get(param);
        if (query) {
          // Normalize: collapse whitespace, trim, cap length at 80 chars
          return query.replace(/\s+/g, ' ').trim().slice(0, 80);
        }
      }
    }
  } catch {
    // Malformed URL — skip
  }
  return null;
}

// Site name suffixes to strip when cleaning page titles for Tier 2 inference.
const _TITLE_SUFFIXES = [
  ' - YouTube', ' | YouTube', ' — YouTube',
  ' - Google Search', ' | Google', ' — Google',
  ' - Bing', ' | Bing',
  ' - DuckDuckGo', ' — DuckDuckGo',
  ' at DuckDuckGo',
];

/**
 * Cleans a raw page title by stripping known site suffixes and normalizing
 * whitespace. Returns null if the result is too short to be useful.
 */
function _cleanTitle(raw) {
  if (!raw) return null;
  let title = raw;
  for (const suffix of _TITLE_SUFFIXES) {
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length);
      break;
    }
  }
  title = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  // Discard if too short or looks like a bare site name
  if (title.length < 8) return null;
  return title;
}

/**
 * Goal inference engine — three-tier extraction strategy:
 *
 *   Tier 1 (highest): Search query parsed directly from URL (?q=, ?search_query=)
 *   Tier 2 (medium):  Cleaned page title after stripping site suffixes
 *   Tier 3 (lowest):  Domain → topic from INFERENCE_KEYWORDS map
 *
 * Tier 1 results always beat Tier 2/3. Within each tier the most-frequent
 * value wins. Only falls to the next tier if the higher tier yields nothing.
 */
async function inferGoalFromHistory() {
  const urls = await getRecentUrls();
  if (urls.length === 0) return null;

  // --- Tier 1: Search query extraction ---
  const searchCounts = {}; // query string → count
  let latestSearchTime = 0;
  let latestSearchQuery = null;

  for (const entry of urls) {
    const query = _extractSearchQuery(entry.url);
    if (query) {
      searchCounts[query] = (searchCounts[query] || 0) + 1;
      // Also track the most recent unique query for tie-breaking
      if ((entry.timestamp || 0) > latestSearchTime) {
        latestSearchTime = entry.timestamp || 0;
        latestSearchQuery = query;
      }
    }
  }

  if (Object.keys(searchCounts).length > 0) {
    // Find the most frequent; break ties by recency (latestSearchQuery)
    let bestQuery = latestSearchQuery;
    let bestCount = 0;
    for (const [q, count] of Object.entries(searchCounts)) {
      if (count > bestCount) {
        bestQuery = q;
        bestCount = count;
      }
    }
    return bestQuery;
  }

  // --- Tier 2: Cleaned page title ---
  const titleCounts = {};

  for (const entry of urls) {
    const title = _cleanTitle(entry.title);
    if (title) {
      titleCounts[title] = (titleCounts[title] || 0) + 1;
    }
  }

  if (Object.keys(titleCounts).length > 0) {
    let bestTitle = null;
    let bestCount = 0;
    for (const [title, count] of Object.entries(titleCounts)) {
      if (count > bestCount) {
        bestTitle = title;
        bestCount = count;
      }
    }
    if (bestTitle) return bestTitle;
  }

  // --- Tier 3: Domain → topic fallback ---
  const topicCounts = {};

  for (const entry of urls) {
    try {
      const hostname = new URL(entry.url).hostname.replace(/^www\./, '');
      for (const [domain, topic] of Object.entries(INFERENCE_KEYWORDS)) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }
    } catch {
      // Invalid URL — skip
    }
  }

  let bestTopic = null;
  let bestCount = 0;
  for (const [topic, count] of Object.entries(topicCounts)) {
    if (count > bestCount) {
      bestTopic = topic;
      bestCount = count;
    }
  }

  return bestTopic; // null if nothing was found
}

// ============================================================
//  REMINDER MESSAGE BUILDER
// ============================================================

async function getReminderMessage() {
  const session = await getSession();

  // Priority 1: User-entered session goal
  if (session.sessionGoal) {
    return { type: 'goal', message: REMINDERS.withGoal(session.sessionGoal) };
  }

  // Priority 2: Previously inferred goal
  if (session.inferredGoal) {
    return { type: 'inferred', message: REMINDERS.withInferred(session.inferredGoal) };
  }

  // Priority 3: Try live inference
  const settings = await getSettings();
  if (settings.goalInferenceEnabled) {
    const inferred = await inferGoalFromHistory();
    if (inferred) {
      await updateSession({ inferredGoal: inferred });
      return { type: 'inferred', message: REMINDERS.withInferred(inferred) };
    }
  }

  // Priority 4: Todo list fallback — pick a random incomplete non-goal todo
  const todos = await getTodos();
  const activeTodos = todos.filter(t => !t.completed && !t.isGoal);
  if (activeTodos.length > 0) {
    const randomTodo = activeTodos[Math.floor(Math.random() * activeTodos.length)];
    return { type: 'todo', message: REMINDERS.withTodo(randomTodo.text) };
  }

  // Priority 5: Generic
  return { type: 'generic', message: REMINDERS.generic };
}

// ============================================================
//  DISTRACTION CHECK
// ============================================================

async function checkDistraction(site, pageType, referrer) {
  const session = await getSession();
  const settings = await getSettings();

  // ---- Break mode active → allow if timer hasn't expired ----
  if (session.breakModeActive) {
    if (session.breakExpiresAt && Date.now() < session.breakExpiresAt) {
      return { shouldBlock: false, reason: 'break_active' };
    }
    // Break expired — clean up
    await updateSession({ breakModeActive: false, breakExpiresAt: null });
  }

  // ---- Chill mode → allow everything ----
  if (session.chillModeActive) {
    return { shouldBlock: false, reason: 'chill_active' };
  }

  // ---- Check if this page type is blocked by settings ----
  let isBlockedType = false;

  if (site === SITE.YOUTUBE) {
    if (pageType === PAGE_TYPE.SHORTS && settings.youtube.blockShorts) isBlockedType = true;
    if (pageType === PAGE_TYPE.HOME_FEED && settings.youtube.blockFeed) isBlockedType = true;
  } else if (site === SITE.INSTAGRAM) {
    const reelTypes = [PAGE_TYPE.REELS, PAGE_TYPE.REELS_FEED, PAGE_TYPE.SINGLE_REEL];
    if (reelTypes.includes(pageType) && settings.instagram.blockReels) isBlockedType = true;
    if (pageType === PAGE_TYPE.HOME_FEED && settings.instagram.blockFeed) isBlockedType = true;
    if (pageType === PAGE_TYPE.EXPLORE && settings.instagram.blockFeed) isBlockedType = true;
  }

  if (!isBlockedType) {
    return { shouldBlock: false, reason: 'allowed_type' };
  }

  // ---- Shared link exception ----
  if (referrer && isExternalReferrer(referrer, site)) {
    // A single short/reel from an external source is likely shared intentionally
    if (pageType === PAGE_TYPE.SHORTS || pageType === PAGE_TYPE.SINGLE_REEL) {
      return { shouldBlock: false, reason: 'shared_link' };
    }
  }

  // ---- Auto-chill: no manual goal + no active tasks → intentional leisure ----
  // If the user opened the browser and went straight to a distracting site
  // without setting any goals or tasks, treat this as deliberate leisure.
  if (settings.autoChillEnabled !== false && !session.sessionGoal) {
    const todos = await getTodos();
    if (!todos.some(t => !t.completed)) {
      await updateSession({ chillModeActive: true });
      console.log('[FocusGuard] Auto-chill activated — no goals or tasks detected');
      return { shouldBlock: false, reason: 'auto_chill' };
    }
  }

  // ---- Standard distraction → show reminder ----
  const reminder = await getReminderMessage();
  return {
    shouldBlock: true,
    reason: 'distraction_detected',
    message: reminder.message,
  };
}

function isExternalReferrer(referrer, currentSite) {
  try {
    const refHost = new URL(referrer).hostname.toLowerCase();
    if (currentSite === SITE.YOUTUBE) return !refHost.includes('youtube.com');
    if (currentSite === SITE.INSTAGRAM) return !refHost.includes('instagram.com');
    return true;
  } catch {
    return false;
  }
}

// ============================================================
//  BREAK TIMER (via chrome.alarms)
// ============================================================

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'fg_break_timer') return;

  await updateSession({ breakModeActive: false, breakExpiresAt: null });

  // Notify all relevant tabs that break ended
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('instagram.com'))) {
      safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
    }
  }

  console.log('[FocusGuard] Break timer expired');
});

// ============================================================
//  MESSAGE HANDLER (popup & content scripts → background)
// ============================================================

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[FocusGuard] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep the message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // ---- State queries ----
    case MSG.GET_STATE: {
      const session = await getSession();
      const todos = await getTodos();
      const settings = await getSettings();
      return { session, todos, settings };
    }

    // ---- Goal actions ----
    case MSG.SET_GOAL: {
      const todo = await addTodo(message.goal, true);
      const wasChilling = (await getSession()).chillModeActive;
      const session = await updateSession({
        sessionGoal: message.goal,
        goalPromptShown: true,
        goalSkipped: false,
        chillModeActive: false,
      });
      // If chill mode was active, notify tabs to re-check blocking rules
      if (wasChilling) await notifyTabsToRecheck();
      return { success: true, session, todo };
    }

    case MSG.SKIP_GOAL: {
      const session = await updateSession({
        goalPromptShown: true,
        goalSkipped: true,
      });
      return { success: true, session };
    }

    // ---- Todo actions ----
    case MSG.ADD_TODO: {
      const todo = await addTodo(message.text);
      const todos = await getTodos();
      // Adding a task signals work intent — deactivate auto-chill
      const curSession = await getSession();
      if (curSession.chillModeActive) {
        await updateSession({ chillModeActive: false });
        await notifyTabsToRecheck();
      }
      return { success: true, todo, todos };
    }

    case MSG.TOGGLE_TODO: {
      const todos = await toggleTodo(message.id);
      const todo = todos.find(t => t.id === message.id);
      // If the session goal was completed, clear it from session
      if (todo && todo.isGoal && todo.completed) {
        await updateSession({ sessionGoal: null });
      } else if (todo && todo.isGoal && !todo.completed) {
        await updateSession({ sessionGoal: todo.text });
      }
      return { success: true, todos };
    }

    case MSG.DELETE_TODO: {
      // Check if deleting the session goal
      const allTodos = await getTodos();
      const target = allTodos.find(t => t.id === message.id);
      if (target && target.isGoal) {
        await updateSession({ sessionGoal: null });
      }
      const todos = await deleteTodo(message.id);
      return { success: true, todos };
    }

    // ---- Break actions ----
    case MSG.START_BREAK: {
      const settings = await getSettings();
      const maxMin = settings.breakMaxMinutes || 15;
      const duration = Math.min(message.minutes, maxMin);
      const expiresAt = Date.now() + duration * 60 * 1000;

      await updateSession({ breakModeActive: true, breakExpiresAt: expiresAt });
      api.alarms.create('fg_break_timer', { when: expiresAt });

      // Unblock all relevant tabs
      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('instagram.com'))) {
          safeSendToTab(tab.id, {
            type: MSG.UNBLOCK_PAGE,
            reason: 'break_started',
            expiresAt,
          });
        }
      }

      return { success: true, expiresAt };
    }

    case MSG.END_BREAK: {
      await updateSession({ breakModeActive: false, breakExpiresAt: null });
      api.alarms.clear('fg_break_timer');

      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('instagram.com'))) {
          safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
        }
      }

      return { success: true };
    }

    // ---- Chill mode ----
    case MSG.ENABLE_CHILL: {
      const session = await updateSession({ chillModeActive: true });

      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('instagram.com'))) {
          safeSendToTab(tab.id, { type: MSG.UNBLOCK_PAGE, reason: 'chill_mode' });
        }
      }

      return { success: true, session };
    }

    case MSG.DISABLE_CHILL: {
      const session = await updateSession({ chillModeActive: false });
      return { success: true, session };
    }

    // ---- Settings ----
    case MSG.GET_SETTINGS: {
      return await getSettings();
    }

    case MSG.UPDATE_SETTINGS: {
      const settings = await updateSettings(message.settings);
      return { success: true, settings };
    }

    // ---- Distraction check (from content scripts) ----
    case MSG.CHECK_DISTRACTION: {
      return await checkDistraction(message.site, message.pageType, message.referrer);
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

console.log('[FocusGuard] Background service worker loaded');
