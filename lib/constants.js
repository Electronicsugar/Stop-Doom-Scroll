/**
 * FocusGuard — Shared Constants (ES Module)
 * Imported by background.js, popup.js, and settings.js
 */

// ====== MESSAGE TYPES ======
export const MSG = {
  // State
  GET_STATE: 'GET_STATE',

  // Goal
  SET_GOAL: 'SET_GOAL',
  SKIP_GOAL: 'SKIP_GOAL',

  // Todos
  ADD_TODO: 'ADD_TODO',
  TOGGLE_TODO: 'TOGGLE_TODO',
  DELETE_TODO: 'DELETE_TODO',

  // Break
  START_BREAK: 'START_BREAK',
  END_BREAK: 'END_BREAK',

  // Session Controls
  PAUSE_SESSION:  'PAUSE_SESSION',
  RESUME_SESSION: 'RESUME_SESSION',
  RESET_SESSION:  'RESET_SESSION',

  // Chill
  ENABLE_CHILL: 'ENABLE_CHILL',
  DISABLE_CHILL: 'DISABLE_CHILL',

  // Settings
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',

  // Distraction
  CHECK_DISTRACTION: 'CHECK_DISTRACTION',
  RECORD_DISTRACTION_BLOCKED: 'RECORD_DISTRACTION_BLOCKED',

  // Navigation (background → content)
  URL_CHANGED: 'URL_CHANGED',
  UNBLOCK_PAGE: 'UNBLOCK_PAGE',
  BREAK_ENDED: 'BREAK_ENDED',
  SHOW_CHILL_REMINDER: 'SHOW_CHILL_REMINDER',

  // Analytics
  // Background writes to storage directly — popup only reads.
  GET_ANALYTICS: 'GET_ANALYTICS',

  // Settings Lock
  LOCK_SETUP: 'LOCK_SETUP',           // { password } → setup lock
  LOCK_VERIFY: 'LOCK_VERIFY',         // { password } → verify, returns { success, locked, lockoutRemainingMs }
  LOCK_DISABLE: 'LOCK_DISABLE',       // { password } → disable lock
  LOCK_GET_STATUS: 'LOCK_GET_STATUS', // → { enabled, unlockDelay, failedAttempts, lockoutUntil, authenticatedUntil }
  LOCK_UPDATE_DELAY: 'LOCK_UPDATE_DELAY', // { delaySeconds } → update delay (requires active auth session)
  LOCK_CHANGE_PASSWORD: 'LOCK_CHANGE_PASSWORD', // { currentPassword, newPassword }
};

// ====== PAGE TYPES ======
export const PAGE_TYPE = {
  HOME_FEED: 'HOME_FEED',
  SHORTS: 'SHORTS',
  REELS: 'REELS',
  REELS_FEED: 'REELS_FEED',
  SINGLE_REEL: 'SINGLE_REEL',
  DIRECT_VIDEO: 'DIRECT_VIDEO',
  DIRECT_POST: 'DIRECT_POST',
  SEARCH: 'SEARCH',
  CHANNEL: 'CHANNEL',
  PROFILE: 'PROFILE',
  STORIES: 'STORIES',
  EXPLORE: 'EXPLORE',
  DIRECT_MSG: 'DIRECT_MSG',
  SUBSCRIPTIONS: 'SUBSCRIPTIONS',
  OTHER: 'OTHER',
};

// ====== SUPPORTED SITES ======
export const SITE = {
  YOUTUBE: 'youtube',
  INSTAGRAM: 'instagram',
};

// ====== DEFAULT SETTINGS ======
export const DEFAULT_SETTINGS = {
  youtube: { blockShorts: true, blockFeed: true },
  instagram: { blockReels: true, blockFeed: true },
  breakMaxMinutes: 10,
  breakButtonEnabled: true,
  goalInferenceEnabled: false, // Opt-in: user must enable in settings
  autoChillEnabled: true,      // Allow auto-chill mode by default
  focusReminderEnabled: false, // Default: disabled
  reminderInterval: 25,        // Default: 25 minutes
  showMission: true,
  showTasks: true,
  showFocusSession: true,
  showFocusStreak: true,
};

// ====== STORAGE KEYS ======
export const STORAGE_KEYS = {
  SETTINGS: 'fg_settings',
  TODOS: 'fg_todos',
  SESSION: 'fg_session',
  STREAK: 'fg_streak',
  RECENT_URLS: 'fg_recent_urls',
  DAILY_ANALYTICS: 'fg_daily_analytics', // { "YYYY-MM-DD": { "hostname": { seconds, visits, lastVisited } } }
  LOCK_CONFIG: 'fg_lock_config',          // { enabled, hash, salt, unlockDelay, failedAttempts, lockoutUntil }
};

// ====== CAPTCHA CONFIG ======
export const CAPTCHA_CONFIG = {
  minLength: 10,
  maxLength: 20,
  charset: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*',
};


// ====== REMINDER MESSAGES ======
export const REMINDERS = {
  withGoal: (goal) => `Stay focused! Your goal: "${goal}"`,
  withInferred: (goal) => `⚠️ Don't get distracted. Keep Working on: ${goal}`,
  withTodo: (task) => `Remember to: ${task}`,
  generic: `Don't get distracted. Go back to work.`,
  chillPrompt: `Do you want to chill today?`,
};

// ====== SEARCH ENGINE QUERY PARAMETERS ======
// Maps hostname fragments to the URL parameter that holds the search query.
// Used by the goal inference engine to extract real search intent from URLs.
export const SEARCH_QUERY_PARAMS = {
  'google.com':       'q',
  'bing.com':         'q',
  'duckduckgo.com':   'q',
  'search.brave.com': 'q',
  'yahoo.com':        'p',
  'youtube.com':      'search_query',
};

// ====== GOAL INFERENCE — Domain → Topic Mapping ======
export const INFERENCE_KEYWORDS = {
  'stackoverflow.com': 'programming',
  'github.com': 'coding',
  'gitlab.com': 'coding',
  'bitbucket.org': 'coding',
  'docs.google.com': 'writing documents',
  'drive.google.com': 'managing files',
  'notion.so': 'organizing notes',
  'figma.com': 'designing',
  'canva.com': 'designing',
  'codepen.io': 'coding',
  'codesandbox.io': 'coding',
  'leetcode.com': 'solving coding problems',
  'hackerrank.com': 'coding challenges',
  'codeforces.com': 'competitive programming',
  'coursera.org': 'online learning',
  'udemy.com': 'online learning',
  'edx.org': 'online learning',
  'khanacademy.org': 'learning',
  'medium.com': 'reading articles',
  'dev.to': 'reading dev articles',
  'cppreference.com': 'learning C++',
  'developer.mozilla.org': 'web development',
  'w3schools.com': 'web development',
  'python.org': 'Python programming',
  'rust-lang.org': 'Rust programming',
  'learn.microsoft.com': 'learning from Microsoft docs',
  'docs.microsoft.com': 'reading Microsoft docs',
  'react.dev': 'learning React',
  'vuejs.org': 'learning Vue.js',
  'angular.io': 'learning Angular',
  'nodejs.org': 'Node.js development',
  'npmjs.com': 'package management',
  'vercel.com': 'deploying projects',
  'netlify.com': 'deploying projects',
  'heroku.com': 'deploying projects',
  'aws.amazon.com': 'cloud services',
  'cloud.google.com': 'cloud services',
  'azure.microsoft.com': 'cloud services',
};

// ====== ANALYTICS — URL schemes to skip ======
// Any hostname containing these patterns should not be tracked.
export const ANALYTICS_SKIP_SCHEMES = [
  'about:', 'chrome:', 'chrome-extension:', 'edge:', 'brave:',
  'view-source:', 'devtools:', 'file:', 'data:', 'blob:', 'moz-extension:',
];

// ====== LOCK — Auth session duration ======
// How long (ms) after a successful unlock before the settings page re-locks automatically.
export const LOCK_AUTH_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// ====== LOCK — Max failed attempts before lockout ======
export const LOCK_MAX_ATTEMPTS = 5;

// ====== LOCK — Lockout duration ======
export const LOCK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
