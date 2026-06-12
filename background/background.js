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
  INFERENCE_KEYWORDS, REMINDERS, DEFAULT_SETTINGS,
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

// ============================================================
//  GOAL INFERENCE ENGINE
// ============================================================

async function inferGoalFromHistory() {
  const urls = await getRecentUrls();
  if (urls.length === 0) return null;

  const topicCounts = {};

  for (const entry of urls) {
    try {
      const hostname = new URL(entry.url).hostname.replace(/^www\./, '');

      // Match against known domain → topic map
      for (const [domain, topic] of Object.entries(INFERENCE_KEYWORDS)) {
        if (hostname.includes(domain)) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }

      // Check URL path & title for learning terms
      const text = `${entry.url} ${entry.title || ''}`.toLowerCase();
      const learningTerms = [
        'tutorial', 'course', 'learn', 'guide',
        'documentation', 'docs', 'reference', 'lesson',
      ];
      for (const term of learningTerms) {
        if (text.includes(term)) {
          const subject = (entry.title || 'something')
            .split(/[\s\-|:]/)[0]
            .trim()
            .slice(0, 30);
          if (subject) {
            const key = `learning ${subject}`;
            topicCounts[key] = (topicCounts[key] || 0) + 1;
          }
        }
      }
    } catch {
      // Invalid URL — skip
    }
  }

  // Find the dominant topic
  let bestTopic = null;
  let bestCount = 0;
  for (const [topic, count] of Object.entries(topicCounts)) {
    if (count > bestCount) {
      bestTopic = topic;
      bestCount = count;
    }
  }

  return bestTopic;
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

  // Priority 4: Todo list fallback
  const todos = await getTodos();
  const activeTodo = todos.find(t => !t.completed && !t.isGoal);
  if (activeTodo) {
    return { type: 'todo', message: REMINDERS.withTodo(activeTodo.text) };
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

  // ---- User hasn't responded to goal prompt yet ----
  if (!session.goalPromptShown) {
    const reminder = await getReminderMessage();
    return {
      shouldBlock: true,
      reason: 'no_goal_set',
      message: reminder.message,
    };
  }

  // ---- User skipped goal, no other signals → offer chill prompt ----
  if (session.goalSkipped && !session.sessionGoal) {
    const reminder = await getReminderMessage();
    if (reminder.type === 'generic') {
      return {
        shouldBlock: true,
        reason: 'chill_prompt',
        showChillPrompt: true,
        message: REMINDERS.chillPrompt,
      };
    }
    return {
      shouldBlock: true,
      reason: 'distraction_detected',
      message: reminder.message,
    };
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
      const session = await updateSession({
        sessionGoal: message.goal,
        goalPromptShown: true,
        goalSkipped: false,
      });
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
