/**
 * FocusGuard — Storage Abstraction Layer (ES Module)
 * Wraps chrome.storage.local with typed helpers for session, todos, and settings.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

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
  return {
    goalPromptShown: false,
    sessionGoal: null,
    goalSkipped: false,
    chillModeActive: false,
    breakModeActive: false,
    breakExpiresAt: null,
    inferredGoal: null,
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
  todos = todos.filter(t => !t.completed);
  // Also remove completed goal items
  todos = todos.filter(t => !(t.isGoal && t.completed));
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
