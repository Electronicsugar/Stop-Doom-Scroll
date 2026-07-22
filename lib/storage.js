/**
 * FocusGuard — Storage Abstraction Layer (ES Module)
 * Wraps chrome.storage.local with typed helpers for session, todos, settings,
 * analytics, and settings lock configuration.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';
import { compileRule, validateRule } from './urlMatcher.js';

const api = (typeof browser !== 'undefined') ? browser : chrome;

// ====== RAW STORAGE ======

export async function storageGet(keys) {
  return api.storage.local.get(keys);
}

export async function storageSet(data) {
  return api.storage.local.set(data);
}

// ====== SESSION STATE ======
// Session state is stored in local storage but cleared on browser startup.
// This approach works across all browsers (no dependency on storage.session).

export function createDefaultSession() {
  const now = Date.now();
  return {
    sessionGoal:        null,
    chillModeActive:    false,
    breakModeActive:    false,
    breakExpiresAt:     null,
    inferredGoal:       null,
    urlChangeCount:     0,
    // ── Session State Machine ──────────────────────────────────────────────
    // sessionState: 'FOCUSING' | 'PAUSED' | 'BREAK'
    // Background is the sole owner of session state.
    // Popup only sends messages; background updates storage.
    sessionState:       'FOCUSING',
    // ── Timer Architecture ─────────────────────────────────────────────────
    // focusStartedAt:     epoch ms of the START of the current focus segment.
    //                     null when PAUSED or BREAK.
    // accumulatedFocusMs: total ms focused before this segment (accumulates
    //                     across pause/resume cycles).
    // pauseStartedAt:     epoch ms when the current pause began (null = not paused).
    // Total focused = accumulatedFocusMs + (Date.now() - focusStartedAt)
    focusStartedAt:     now,
    accumulatedFocusMs: 0,
    pauseStartedAt:     null,
    // ── Session Metadata ──────────────────────────────────────────────────
    sessionStartedAt:   now,   // wall-clock start (for "Started at 10:15 AM")
    breakCount:         0,     // breaks taken this session
    chillStartedAt:     null,  // epoch ms when user started chilling on a blocked site
    chillReminderPending: false, // true if user has spent reminderInterval min and needs a prompt
  };
}


export async function getSession() {
  const result = await api.storage.local.get(STORAGE_KEYS.SESSION);
  return result[STORAGE_KEYS.SESSION] || createDefaultSession();
}

export async function setSession(data) {
  return api.storage.local.set({ [STORAGE_KEYS.SESSION]: data });
}

export async function updateSession(partial) {
  const current = await getSession();
  const updated = { ...current, ...partial };
  await setSession(updated);
  return updated;
}

// ====== TODOS ======

export async function getTodos() {
  const result = await api.storage.local.get(STORAGE_KEYS.TODOS);
  return result[STORAGE_KEYS.TODOS] || [];
}

export async function setTodos(todos) {
  return api.storage.local.set({ [STORAGE_KEYS.TODOS]: todos });
}

export async function addTodo(text, isGoal = false) {
  const todos = await getTodos();
  const todo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text,
    isGoal,
    completed: false,
    createdAt: Date.now(),
  };
  if (isGoal) {
    todos.unshift(todo); // Session goal pinned at top
  } else {
    // Insert after any goal items but before other items
    const goalIndex = todos.findIndex(t => t.isGoal);
    if (goalIndex >= 0) {
      todos.splice(goalIndex + 1, 0, todo);
    } else {
      todos.unshift(todo);
    }
  }
  await setTodos(todos);
  return todo;
}

export async function toggleTodo(id) {
  const todos = await getTodos();
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    await setTodos(todos);
  }
  return todos;
}

export async function deleteTodo(id) {
  let todos = await getTodos();
  todos = todos.filter(t => t.id !== id);
  await setTodos(todos);
  return todos;
}

export async function clearCompletedTodos() {
  let todos = await getTodos();
  // Remove completed tasks
  todos = todos.filter(t => !t.completed);
  // Remove ALL goals from previous sessions (they shouldn't persist to a new session)
  todos = todos.filter(t => !t.isGoal);
  await setTodos(todos);
  return todos;
}

// ====== SETTINGS ======

export async function getSettings() {
  const result = await api.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS] || {};
  // Deep merge with defaults to ensure all keys exist
  return {
    youtube: { ...DEFAULT_SETTINGS.youtube, ...(stored.youtube || {}) },
    instagram: { ...DEFAULT_SETTINGS.instagram, ...(stored.instagram || {}) },
    breakMaxMinutes: stored.breakMaxMinutes ?? DEFAULT_SETTINGS.breakMaxMinutes,
    breakButtonEnabled: stored.breakButtonEnabled ?? DEFAULT_SETTINGS.breakButtonEnabled,
    goalInferenceEnabled: stored.goalInferenceEnabled ?? DEFAULT_SETTINGS.goalInferenceEnabled,
    autoChillEnabled: stored.autoChillEnabled ?? DEFAULT_SETTINGS.autoChillEnabled,
    focusReminderEnabled: stored.focusReminderEnabled ?? DEFAULT_SETTINGS.focusReminderEnabled,
    reminderInterval: stored.reminderInterval ?? DEFAULT_SETTINGS.reminderInterval,
    showMission: stored.showMission ?? DEFAULT_SETTINGS.showMission,
    showTasks: stored.showTasks ?? DEFAULT_SETTINGS.showTasks,
    showFocusSession: stored.showFocusSession ?? DEFAULT_SETTINGS.showFocusSession,
    showFocusStreak: stored.showFocusStreak ?? DEFAULT_SETTINGS.showFocusStreak,
  };
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current };
  if (partial.youtube) updated.youtube = { ...current.youtube, ...partial.youtube };
  if (partial.instagram) updated.instagram = { ...current.instagram, ...partial.instagram };
  if (partial.breakMaxMinutes !== undefined) updated.breakMaxMinutes = partial.breakMaxMinutes;
  if (partial.breakButtonEnabled !== undefined) updated.breakButtonEnabled = partial.breakButtonEnabled;
  if (partial.goalInferenceEnabled !== undefined) updated.goalInferenceEnabled = partial.goalInferenceEnabled;
  if (partial.autoChillEnabled !== undefined) updated.autoChillEnabled = partial.autoChillEnabled;
  if (partial.focusReminderEnabled !== undefined) updated.focusReminderEnabled = partial.focusReminderEnabled;
  if (partial.reminderInterval !== undefined) updated.reminderInterval = partial.reminderInterval;
  if (partial.showMission !== undefined) updated.showMission = partial.showMission;
  if (partial.showTasks !== undefined) updated.showTasks = partial.showTasks;
  if (partial.showFocusSession !== undefined) updated.showFocusSession = partial.showFocusSession;
  if (partial.showFocusStreak !== undefined) updated.showFocusStreak = partial.showFocusStreak;
  await api.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

// ====== RECENT URLS (for goal inference) ======

export async function getRecentUrls() {
  const result = await api.storage.local.get(STORAGE_KEYS.RECENT_URLS);
  return result[STORAGE_KEYS.RECENT_URLS] || [];
}

export async function addRecentUrl(url, title) {
  let urls = await getRecentUrls();
  urls.unshift({ url, title, timestamp: Date.now() });
  // Keep only last 30 minutes and max 50 entries
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  urls = urls.filter(u => u.timestamp > thirtyMinAgo).slice(0, 50);
  await api.storage.local.set({ [STORAGE_KEYS.RECENT_URLS]: urls });
  return urls;
}

export async function clearRecentUrls() {
  return api.storage.local.set({ [STORAGE_KEYS.RECENT_URLS]: [] });
}

// ====== STREAK / DAILY STATS ======
// fg_streak stores long-term productivity history, separate from session state.
// Structure: { todayFocusMs, longestSessionMs, currentStreak, bestStreak, lastFocusDate }

export function createDefaultStreak() {
  return {
    todayFocusMs:     0,
    longestSessionMs: 0,
    currentStreak:    0,
    bestStreak:       0,
    lastFocusDate:    null,  // 'YYYY-MM-DD' string
    distractionsBlocked: 0,
  };
}

export async function getStreak() {
  const result = await api.storage.local.get(STORAGE_KEYS.STREAK);
  const streak = result[STORAGE_KEYS.STREAK] || createDefaultStreak();
  const today  = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Reset today's focus time on a new day
  if (streak.lastFocusDate !== today) {
    streak.todayFocusMs = 0;
    await api.storage.local.set({ [STORAGE_KEYS.STREAK]: streak });
  }
  return streak;
}

export async function updateStreak(sessionFocusMs) {
  if (!sessionFocusMs || sessionFocusMs < 60000) return; // ignore < 1 min sessions
  const streak = await getStreak();
  const today  = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Accumulate today's focus
  const sameDay = streak.lastFocusDate === today;
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  const todayFocusMs = sameDay
    ? streak.todayFocusMs + sessionFocusMs
    : sessionFocusMs;

  // Streak logic: increment if focused yesterday or today, reset if gap
  let currentStreak = streak.currentStreak || 0;
  if (!streak.lastFocusDate || streak.lastFocusDate < yesterday) {
    currentStreak = 1; // gap — reset streak
  } else if (!sameDay) {
    currentStreak += 1; // consecutive day
  }
  // If same day: streak stays same

  const longestSessionMs = Math.max(streak.longestSessionMs || 0, sessionFocusMs);
  const bestStreak       = Math.max(streak.bestStreak || 0, currentStreak);

  const updated = {
    todayFocusMs,
    longestSessionMs,
    currentStreak,
    bestStreak,
    lastFocusDate: today,
  };

  await api.storage.local.set({ [STORAGE_KEYS.STREAK]: updated });
  return updated;
}

export async function incrementDistractionsBlocked() {
  const streak = await getStreak();
  streak.distractionsBlocked = (streak.distractionsBlocked || 0) + 1;
  await api.storage.local.set({ [STORAGE_KEYS.STREAK]: streak });
  return streak;
}

// ====== SETTINGS LOCK CONFIG ======
// Stores the lock configuration including the PBKDF2 hash and salt.
// Never stores plaintext passwords.

/**
 * Returns safe defaults for lock configuration.
 * Used when no lock has been configured or during migration.
 */
export function createDefaultLockConfig() {
  return {
    enabled:        false,
    hash:           null,   // hex string of PBKDF2 hash
    salt:           null,   // hex string of random salt
    unlockDelay:    10,     // fixed 10 seconds delay
    failedAttempts: 0,
    lockoutUntil:   0,      // epoch ms (0 = no lockout)
  };
}

export async function getLockConfig() {
  const result = await api.storage.local.get(STORAGE_KEYS.LOCK_CONFIG);
  const stored = result[STORAGE_KEYS.LOCK_CONFIG];
  if (!stored) return createDefaultLockConfig();
  // Merge with defaults to handle migrations gracefully
  return { ...createDefaultLockConfig(), ...stored };
}

export async function setLockConfig(config) {
  return api.storage.local.set({ [STORAGE_KEYS.LOCK_CONFIG]: config });
}

export async function updateLockConfig(partial) {
  const current = await getLockConfig();
  const updated = { ...current, ...partial };
  await setLockConfig(updated);
  return updated;
}

// ====== BLOCKED URLS (Universal Blocker) ======

export async function getBlockedUrls() {
  const result = await api.storage.local.get(STORAGE_KEYS.BLOCKED_URLS);
  return result[STORAGE_KEYS.BLOCKED_URLS] || [];
}

/**
 * Bulk updates the entire blocked rules list. Compiles rules before saving.
 * Used for imports and migrations.
 */
export async function setBlockedUrls(rules) {
  if (!Array.isArray(rules)) return false;
  
  const validRules = [];
  const seen = new Set();
  
  for (const rawRule of rules) {
    if (validateRule(rawRule).valid) {
      const compiled = compileRule(rawRule);
      const uniqueKey = `${compiled.normalizedPattern}_${compiled.type}`;
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        // Clean up regex before saving to storage (regex instances can't be stored in some browsers)
        const toSave = { ...compiled };
        delete toSave.regex; 
        validRules.push(toSave);
      }
    }
  }
  
  await api.storage.local.set({ [STORAGE_KEYS.BLOCKED_URLS]: validRules });
  return validRules;
}

export async function addBlockedUrl(ruleData) {
  const rules = await getBlockedUrls();
  const compiled = compileRule(ruleData);
  
  // Deduplication check
  const isDuplicate = rules.some(r => r.normalizedPattern === compiled.normalizedPattern && r.type === compiled.type);
  if (isDuplicate) return null; // already exists
  
  const toSave = {
    ...compiled,
    id: ruleData.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    createdAt: ruleData.createdAt || Date.now(),
    updatedAt: Date.now(),
    version: 1
  };
  delete toSave.regex;
  
  rules.push(toSave);
  await api.storage.local.set({ [STORAGE_KEYS.BLOCKED_URLS]: rules });
  return toSave;
}

export async function updateBlockedUrl(id, partial) {
  const rules = await getBlockedUrls();
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  
  let updatedRule = { ...rules[idx], ...partial, updatedAt: Date.now() };
  if (partial.pattern || partial.type) {
    updatedRule = compileRule(updatedRule);
  }
  
  delete updatedRule.regex;
  rules[idx] = updatedRule;
  await api.storage.local.set({ [STORAGE_KEYS.BLOCKED_URLS]: rules });
  return updatedRule;
}

export async function deleteBlockedUrl(id) {
  let rules = await getBlockedUrls();
  rules = rules.filter(r => r.id !== id);
  await api.storage.local.set({ [STORAGE_KEYS.BLOCKED_URLS]: rules });
  return rules;
}
