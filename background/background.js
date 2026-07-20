/**
 * FocusGuard — Background Service Worker (ES Module)
 * 
 * Responsibilities:
 * - Session lifecycle management (init on startup, cleanup)
 * - Message routing between popup/content scripts
 * - Goal inference from recent browsing activity
 * - Break timer management via chrome.alarms
 * - SPA navigation detection via webNavigation API
 * - Website usage analytics (event-driven, no polling)
 * - Settings lock: PBKDF2 password hashing and verification
 */

import {
  MSG, STORAGE_KEYS, SITE, PAGE_TYPE,
  INFERENCE_KEYWORDS, SEARCH_QUERY_PARAMS, REMINDERS, DEFAULT_SETTINGS,
  LOCK_MAX_ATTEMPTS, LOCK_COOLDOWN_MS, LOCK_AUTH_TIMEOUT_MS,
} from '../lib/constants.js';

import {
  getSession, setSession, updateSession, createDefaultSession,
  getStreak, updateStreak, incrementDistractionsBlocked,
  getTodos, addTodo, toggleTodo, deleteTodo, clearCompletedTodos,
  getSettings, updateSettings,
  getRecentUrls, addRecentUrl, clearRecentUrls,
  getLockConfig, setLockConfig, updateLockConfig,
} from '../lib/storage.js';

import { validatePassword } from '../lib/password.js';

import {
  startTracking, stopTracking, flush, getAnalytics, clearAnalytics,
} from '../lib/analytics.js';

const api = (typeof browser !== 'undefined') ? browser : chrome;

// ============================================================
//  SESSION LIFECYCLE
// ============================================================

async function initSession() {
  const session = createDefaultSession();
  await setSession(session);
  await clearCompletedTodos();
  await clearRecentUrls();
  await clearAnalytics();
}

// Browser launched → new session
api.runtime.onStartup.addListener(() => {
  initSession();
});

// Extension installed or updated
api.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    api.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
  initSession();
});

// ============================================================
//  TAB URL TRACKING (for goal inference, opt-in)
// ============================================================

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.url || !tab.url.startsWith('http')) return;

  try {
    // Only count active tab navigations to avoid hitting the limit from background tab restores
    if (tab.active) {
      const session = await getSession();
      const newCount = (session.urlChangeCount || 0) + 1;
      await updateSession({ urlChangeCount: newCount });
    }

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
  const tabs = await api.tabs.query({ url: ["*://*.youtube.com/*", "*://*.instagram.com/*"] });
  for (const tab of tabs) {
    safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
  }
}

// ============================================================
//  ANALYTICS TRACKING (event-driven — no polling)
// ============================================================

// Whether the browser window is currently focused
let windowFocused = true;

/**
 * Called when the active tab or window changes.
 * Looks up the new active tab and starts tracking it.
 *
 * @param {number} windowId  the currently focused window (or WINDOW_ID_NONE)
 * @param {boolean} isNewVisit  whether to count this as a new visit
 */
async function handleActiveTabChange(windowId, isNewVisit = false) {
  if (!windowFocused || windowId === (api.windows && api.windows.WINDOW_ID_NONE || -1)) {
    await stopTracking();
    return;
  }
  try {
    const tabs = await api.tabs.query({ active: true, windowId });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      await startTracking(tabs[0].id, tabs[0].url, windowId, isNewVisit);
    } else {
      await stopTracking();
    }
  } catch {
    await stopTracking();
  }
}

// Tab switches within the same window
api.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await api.tabs.get(activeInfo.tabId);
    await startTracking(activeInfo.tabId, tab?.url || '', activeInfo.windowId, true);
  } catch {
    await stopTracking();
  }
});

// URL changes within a tab (navigation, SPA route changes)
api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;                   // only care about the active tab
  if (changeInfo.status !== 'complete') return; // wait for full load
  if (!tab.url) return;
  await startTracking(tabId, tab.url, tab.windowId, true);
});

// Browser window focus changes
if (api.windows && api.windows.onFocusChanged) {
  api.windows.onFocusChanged.addListener(async (windowId) => {
    const NONE = api.windows.WINDOW_ID_NONE;
    if (windowId === NONE) {
      // Browser lost focus (minimized, another app, etc.)
      windowFocused = false;
      await stopTracking();
    } else {
      // Browser regained focus
      windowFocused = true;
      await handleActiveTabChange(windowId, false);
    }
  });
}

// Service worker suspension: flush any pending time before the SW sleeps.
// chrome.runtime.onSuspend fires just before the service worker is terminated.
api.runtime.onSuspend.addListener(async () => {
  await flush(false);
});

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

  const searchCounts = {};
  const titleCounts = {};
  const topicCounts = {};
  let latestSearchTime = 0;
  let latestSearchQuery = null;

  // Single pass over URLs to populate all tiers
  for (const entry of urls) {
    // Tier 1
    const query = _extractSearchQuery(entry.url);
    if (query) {
      searchCounts[query] = (searchCounts[query] || 0) + 1;
      if ((entry.timestamp || 0) > latestSearchTime) {
        latestSearchTime = entry.timestamp || 0;
        latestSearchQuery = query;
      }
    }

    // Tier 2
    const title = _cleanTitle(entry.title);
    if (title) {
      titleCounts[title] = (titleCounts[title] || 0) + 1;
    }

    // Tier 3
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

  // --- Resolve Tier 1 ---
  if (Object.keys(searchCounts).length > 0) {
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

  // --- Resolve Tier 2 ---
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

  // --- Resolve Tier 3 ---
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
//  CHILL MODE STATE & ALARM MANAGEMENT
// ============================================================

async function activateChill() {
  const settings = await getSettings();
  await updateSession({
    chillModeActive: true,
    chillStartedAt: Date.now(),
    chillReminderPending: false
  });
  api.alarms.clear('fg_chill_reminder');
  if (settings.focusReminderEnabled) {
    api.alarms.create('fg_chill_reminder', { delayInMinutes: settings.reminderInterval });
  }
}

async function deactivateChill() {
  await updateSession({
    chillModeActive: false,
    chillStartedAt: null,
    chillReminderPending: false
  });
  api.alarms.clear('fg_chill_reminder');
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

async function checkDistraction(site, pageType, previousPageType, referrer) {
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

  // ---- Chill mode active ----
  if (session.chillModeActive) {
    if (settings.focusReminderEnabled) {
      if (session.chillReminderPending) {
        return { 
          shouldBlock: true, 
          reason: 'chill_reminder_prompt',
          showChillReminderPrompt: true,
          reminderInterval: settings.reminderInterval,
          message: `You are using a blocked website for ${settings.reminderInterval} min. Do you still want to chill?`
        };
      }

      // Start/reset timer if it wasn't running
      if (!session.chillStartedAt) {
        await updateSession({ chillStartedAt: Date.now() });
        api.alarms.create('fg_chill_reminder', { delayInMinutes: settings.reminderInterval });
      }
    }

    return { shouldBlock: false, reason: 'chill_active' };
  }

  // ---- Check if this page type is blocked by settings ----
  let isBlockedType = false;

  if (site === SITE.YOUTUBE) {
    if (pageType === PAGE_TYPE.SHORTS && settings.youtube.blockShorts) {
      // Consecutive doomscroll mechanic: allow first Short, block subsequent
      if (previousPageType === PAGE_TYPE.SHORTS) {
        isBlockedType = true;
      }
    }
    if (pageType === PAGE_TYPE.HOME_FEED && settings.youtube.blockFeed) isBlockedType = true;
  } else if (site === SITE.INSTAGRAM) {
    const reelTypes = [PAGE_TYPE.REELS, PAGE_TYPE.REELS_FEED, PAGE_TYPE.SINGLE_REEL];
    if (reelTypes.includes(pageType) && settings.instagram.blockReels) {
      // Consecutive doomscroll mechanic: allow first Reel, block subsequent
      if (reelTypes.includes(previousPageType)) {
        isBlockedType = true;
      }
    }
    if (pageType === PAGE_TYPE.HOME_FEED && settings.instagram.blockFeed) isBlockedType = true;
    if (pageType === PAGE_TYPE.EXPLORE && settings.instagram.blockFeed) isBlockedType = true;
  }

  if (!isBlockedType) {
    return { shouldBlock: false, reason: 'allowed_type' };
  }

  // ---- Auto-chill prompt: explicit rules based on UI context ----
  function shouldShowChillPrompt(session, todos) {
    if (session.sessionGoal) return false;
    if (session.inferredGoal) return false;
    if (todos.some(t => !t.completed)) return false;
    if (session.goalPromptShown) return false; // Already prompted this session
    return true; 
  }

  if (settings.autoChillEnabled !== false) {
    // 1. Check tasks
    const todos = await getTodos();
    
    // 2. Check for inferred goals (live inference)
    let hasInferredGoal = !!session.inferredGoal;
    if (!hasInferredGoal && settings.goalInferenceEnabled) {
      const inferred = await inferGoalFromHistory();
      if (inferred) {
        await updateSession({ inferredGoal: inferred });
        session.inferredGoal = inferred;
      }
    }

    if (shouldShowChillPrompt(session, todos)) {
      return { 
        shouldBlock: true, 
        reason: 'chill_prompt',
        showChillPrompt: true, 
        message: 'Do you want to chill today?'
      };
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



// ============================================================
//  BREAK TIMER (via chrome.alarms)
// ============================================================

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fg_break_timer') {
    // Atomically clear break state and start a new focus session.
    // focusStartedAt is set to NOW so the popup timer resets to 00:00:00.
    await updateSession({
      breakModeActive:    false,
      breakExpiresAt:     null,
      sessionState:       'FOCUSING',
      focusStartedAt:     Date.now(),
      accumulatedFocusMs: 0,
    });

    // Notify all relevant tabs that break ended
    const tabs = await api.tabs.query({ url: ["*://*.youtube.com/*", "*://*.instagram.com/*"] });
    for (const tab of tabs) {
      safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
    }
  } else if (alarm.name === 'fg_chill_reminder') {
    const session = await getSession();
    if (!session.chillModeActive) return;

    const settings = await getSettings();
    if (!settings.focusReminderEnabled) return;

    // Set pending so any future checks block them
    await updateSession({ chillReminderPending: true });

    // Show on the current active tab if it's a blocked site
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].url) {
      const url = tabs[0].url;
      if (url.includes('youtube.com') || url.includes('instagram.com')) {
        safeSendToTab(tabs[0].id, {
          type: MSG.SHOW_CHILL_REMINDER,
          reminderInterval: settings.reminderInterval
        });
      }
    }
  }
});

// ============================================================
//  SETTINGS LOCK — CRYPTO HELPERS
// ============================================================

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a hex string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hashes a password using PBKDF2-SHA256 with 100,000 iterations.
 * Returns { hash: hex, salt: hex }.
 * Uses a random 16-byte salt if none is provided.
 *
 * @param {string} password
 * @param {string} [existingSaltHex]  optional existing salt (for verification)
 * @returns {Promise<{ hash: string, salt: string }>}
 */
async function hashPassword(password, existingSaltHex) {
  const enc = new TextEncoder();
  const saltBytes = existingSaltHex
    ? hexToBytes(existingSaltHex)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
  };
}

/**
 * Verifies a plaintext password against a stored hash and salt.
 * Uses constant-time comparison to resist timing attacks.
 *
 * @param {string} password
 * @param {string} storedHash  hex
 * @param {string} storedSalt  hex
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash, storedSalt) {
  try {
    const { hash } = await hashPassword(password, storedSalt);
    // Constant-time comparison: compare every byte even if one differs early
    if (hash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) {
      diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

// ============================================================
//  SETTINGS LOCK — AUTH SESSION (in-memory, background-owned)
// ============================================================

// The timestamp until which the settings page is considered authenticated.
// Stored only in memory — resets on service worker restart.
let lockAuthenticatedUntil = 0;

/**
 * Returns true if the current authentication session is still valid.
 */
function isAuthSessionActive() {
  return Date.now() < lockAuthenticatedUntil;
}

/**
 * Grants a new authentication session for LOCK_AUTH_TIMEOUT_MS milliseconds.
 */
function grantAuthSession() {
  lockAuthenticatedUntil = Date.now() + LOCK_AUTH_TIMEOUT_MS;
}

/**
 * Revokes the current authentication session immediately.
 */
function revokeAuthSession() {
  lockAuthenticatedUntil = 0;
}

// ============================================================
//  MESSAGE HANDLER (popup & content scripts → background)
// ============================================================

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error('[FocusGuard] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep the message channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {

    // ---- State queries ----
    case MSG.GET_STATE: {
      const session = await getSession();
      const todos = await getTodos();
      const settings = await getSettings();
      const streak = await getStreak();
      return { uiState: { session, todos, settings, streak } };
    }

    // ---- Goal actions ----
    case MSG.SET_GOAL: {
      const todo = await addTodo(message.goal, true);
      const wasChilling = (await getSession()).chillModeActive;
      if (wasChilling) {
        await deactivateChill();
      }
      const session = await updateSession({
        sessionGoal: message.goal,
        goalPromptShown: true,
        goalSkipped: false,
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
        await deactivateChill();
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
      const currentSess = await getSession();
      
      const maxBreaks = settings.breakMaxPerDayCount ?? 5;
      if ((currentSess.breakCount || 0) >= maxBreaks) {
        return { success: false, reason: 'limit_reached' };
      }

      const maxMin = settings.breakMaxMinutes || 15;
      const duration = Math.min(message.minutes, maxMin);
      const expiresAt = Date.now() + duration * 60 * 1000;

      const nowMs = Date.now();
      const segmentMs = currentSess.focusStartedAt
        ? nowMs - currentSess.focusStartedAt
        : 0;
      const totalFocusMs = (currentSess.accumulatedFocusMs || 0) + segmentMs;

      // Atomically set break state, null out timer, update sessionState and breakCount.
      // Background owns all session state — popup never writes storage directly.
      await updateSession({
        breakModeActive:    true,
        breakExpiresAt:     expiresAt,
        sessionState:       'BREAK',
        focusStartedAt:     null,
        accumulatedFocusMs: totalFocusMs,
        breakCount:         (currentSess.breakCount || 0) + 1,
      });

      // Update streak with this focus segment
      await updateStreak(totalFocusMs);

      api.alarms.create('fg_break_timer', { when: expiresAt });

      // Unblock all relevant tabs
      const tabs = await api.tabs.query({ url: ["*://*.youtube.com/*", "*://*.instagram.com/*"] });
      for (const tab of tabs) {
        safeSendToTab(tab.id, {
          type: MSG.UNBLOCK_PAGE,
          reason: 'break_started',
          expiresAt,
        });
      }

      return { success: true, expiresAt };
    }

    case MSG.PAUSE_SESSION: {
      // Pause the focus timer. Blocking remains fully active — we only stop the clock.
      const sess = await getSession();
      if (sess.sessionState !== 'FOCUSING') return { success: false, reason: 'not_focusing' };
      const now  = Date.now();
      const segMs = sess.focusStartedAt ? (now - sess.focusStartedAt) : 0;
      await updateSession({
        sessionState:       'PAUSED',
        focusStartedAt:     null,
        pauseStartedAt:     now,
        accumulatedFocusMs: (sess.accumulatedFocusMs || 0) + segMs,
      });
      return { success: true };
    }

    case MSG.RESUME_SESSION: {
      // Resume the focus timer from where it was paused.
      const sess2 = await getSession();
      if (sess2.sessionState !== 'PAUSED') return { success: false, reason: 'not_paused' };
      await updateSession({
        sessionState:   'FOCUSING',
        focusStartedAt: Date.now(),
        pauseStartedAt: null,
      });
      return { success: true };
    }

    case MSG.RESET_SESSION: {
      // Reset creates a completely new focus session.
      // Does NOT affect break mode — if a break is active it stays.
      const sess3  = await getSession();
      const now3   = Date.now();
      // Accumulate any remaining focus time into streak before reset
      let totalMs3 = sess3.accumulatedFocusMs || 0;
      if (sess3.focusStartedAt) totalMs3 += now3 - sess3.focusStartedAt;
      await updateStreak(totalMs3);

      // Create fresh timer state, preserving break state if a break is running
      await updateSession({
        sessionState:       sess3.breakModeActive ? 'BREAK' : 'FOCUSING',
        focusStartedAt:     sess3.breakModeActive ? null : now3,
        accumulatedFocusMs: 0,
        pauseStartedAt:     null,
        sessionStartedAt:   now3,
        breakCount:         0,
      });
      return { success: true };
    }

    case MSG.END_BREAK: {
      // Atomically clear break and start a new focus session.
      // This is the ONLY path that resets the focus timer to 00:00:00.
      await updateSession({
        breakModeActive:    false,
        breakExpiresAt:     null,
        sessionState:       'FOCUSING',
        focusStartedAt:     Date.now(),
        accumulatedFocusMs: 0,
      });
      api.alarms.clear('fg_break_timer');

      const tabs = await api.tabs.query({ url: ["*://*.youtube.com/*", "*://*.instagram.com/*"] });
      for (const tab of tabs) {
        safeSendToTab(tab.id, { type: MSG.BREAK_ENDED });
      }

      return { success: true };
    }

    // ---- Chill mode ----
    case MSG.ENABLE_CHILL: {
      await activateChill();
      const session = await getSession();

      const tabs = await api.tabs.query({ url: ["*://*.youtube.com/*", "*://*.instagram.com/*"] });
      for (const tab of tabs) {
        safeSendToTab(tab.id, { type: MSG.UNBLOCK_PAGE, reason: 'chill_mode' });
      }

      return { success: true, session };
    }

    case MSG.DISABLE_CHILL: {
      await deactivateChill();
      const session = await getSession();
      await notifyTabsToRecheck();
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
      return await checkDistraction(message.site, message.pageType, message.previousPageType, message.referrer);
    }
    
    case MSG.RECORD_DISTRACTION_BLOCKED: {
      return await incrementDistractionsBlocked();
    }

    // ---- Analytics ----
    case MSG.GET_ANALYTICS: {
      // Flush current session so the returned data includes time up to this moment
      await flush(false);
      const data = await getAnalytics(message.date || null);
      return { success: true, data };
    }

    // ---- Settings Lock ----
    case MSG.LOCK_GET_STATUS: {
      const cfg = await getLockConfig();
      return {
        enabled:            cfg.enabled,
        unlockDelay:        cfg.unlockDelay,
        failedAttempts:     cfg.failedAttempts,
        lockoutUntil:       cfg.lockoutUntil,
        authenticatedUntil: lockAuthenticatedUntil,
        isAuthenticated:    isAuthSessionActive(),
      };
    }

    case MSG.LOCK_SETUP: {
      const val = validatePassword(message.password);
      if (!val.isValid) {
        return { success: false, error: 'invalid_password', ruleStatus: val.ruleStatus };
      }
      const { hash, salt } = await hashPassword(message.password);
      await setLockConfig({
        enabled:        true,
        hash,
        salt,
        unlockDelay:    0,
        failedAttempts: 0,
        lockoutUntil:   0,
      });
      revokeAuthSession();
      return { success: true };
    }

    case MSG.LOCK_VERIFY: {
      const cfg = await getLockConfig();
      if (!cfg.enabled) return { success: true, wasLocked: false };

      // Check lockout
      if (cfg.lockoutUntil && Date.now() < cfg.lockoutUntil) {
        return {
          success: false,
          locked: true,
          lockoutRemainingMs: cfg.lockoutUntil - Date.now(),
        };
      }

      const ok = await verifyPassword(message.password, cfg.hash, cfg.salt);
      if (ok) {
        await updateLockConfig({ failedAttempts: 0, lockoutUntil: 0 });
        grantAuthSession();
        return { success: true };
      } else {
        const newAttempts = (cfg.failedAttempts || 0) + 1;
        const lockoutUntil = newAttempts >= LOCK_MAX_ATTEMPTS
          ? Date.now() + LOCK_COOLDOWN_MS
          : 0;
        await updateLockConfig({ failedAttempts: newAttempts, lockoutUntil });
        return {
          success: false,
          locked: lockoutUntil > 0,
          lockoutRemainingMs: lockoutUntil > 0 ? LOCK_COOLDOWN_MS : 0,
          attemptsRemaining: Math.max(0, LOCK_MAX_ATTEMPTS - newAttempts),
        };
      }
    }

    case MSG.LOCK_DISABLE: {
      const cfg = await getLockConfig();
      if (!cfg.enabled) return { success: true };

      // Check lockout
      if (cfg.lockoutUntil && Date.now() < cfg.lockoutUntil) {
        return {
          success: false,
          locked: true,
          lockoutRemainingMs: cfg.lockoutUntil - Date.now(),
        };
      }

      const ok = await verifyPassword(message.password, cfg.hash, cfg.salt);
      if (!ok) {
        const newAttempts = (cfg.failedAttempts || 0) + 1;
        const lockoutUntil = newAttempts >= LOCK_MAX_ATTEMPTS
          ? Date.now() + LOCK_COOLDOWN_MS
          : 0;
        await updateLockConfig({ failedAttempts: newAttempts, lockoutUntil });
        return { success: false, locked: lockoutUntil > 0, lockoutRemainingMs: lockoutUntil > 0 ? LOCK_COOLDOWN_MS : 0 };
      }

      await setLockConfig({
        enabled: false, hash: null, salt: null,
        unlockDelay: 0, failedAttempts: 0, lockoutUntil: 0,
      });
      revokeAuthSession();
      return { success: true };
    }

    case MSG.LOCK_CHANGE_PASSWORD: {
      const cfg = await getLockConfig();
      if (!cfg.enabled) return { success: false, error: 'lock_not_enabled' };

      // Must verify current password first
      const ok = await verifyPassword(message.currentPassword, cfg.hash, cfg.salt);
      if (!ok) return { success: false, error: 'invalid_password' };

      const val = validatePassword(message.newPassword);
      if (!val.isValid) {
        return { success: false, error: 'invalid_password', ruleStatus: val.ruleStatus };
      }

      const { hash, salt } = await hashPassword(message.newPassword);
      await updateLockConfig({ hash, salt, failedAttempts: 0, lockoutUntil: 0 });
      grantAuthSession();
      return { success: true };
    }

    case MSG.LOCK_UPDATE_DELAY: {
      // Only allowed when an active auth session exists
      if (!isAuthSessionActive()) {
        return { success: false, error: 'not_authenticated' };
      }
      await updateLockConfig({ unlockDelay: message.delaySeconds || 0 });
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}
