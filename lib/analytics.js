/**
 * Sage — Analytics Tracker (ES Module)
 *
 * Encapsulates all website usage tracking logic.
 * Background service worker imports this and wires it to browser events.
 *
 * Responsibilities:
 *  - startTracking / stopTracking / flush
 *  - Hostname normalization (strips www., m. prefixes)
 *  - Skipping internal / irrelevant URLs
 *  - Writing rich analytics records: { seconds, visits, lastVisited }
 *  - getAnalytics(date?) — returns sorted array for popup consumption
 *
 * The background service worker owns event wiring.
 * This module owns all business logic.
 */

import { STORAGE_KEYS, ANALYTICS_SKIP_SCHEMES } from './constants.js';

const api = (typeof browser !== 'undefined') ? browser : chrome;

// ── In-memory active session ───────────────────────────────────────────────
// Represents the currently tracked tab. Reset whenever tracking pauses.
let activeSession = null;
// {
//   tabId:    number,
//   hostname: string,   // normalized
//   startMs:  number,   // Date.now() when tracking started
//   windowId: number,
// }

// ── Hostname normalization ─────────────────────────────────────────────────

/**
 * Normalizes a hostname by stripping common mobile/www prefixes so that
 * youtube.com, www.youtube.com, and m.youtube.com all map to "youtube.com".
 *
 * @param {string} hostname
 * @returns {string} normalized hostname
 */
export function normalizeHostname(hostname) {
  if (!hostname) return '';
  // Strip leading www. or m.
  return hostname.replace(/^(www\.|m\.)/, '');
}

// ── URL filtering ──────────────────────────────────────────────────────────

/**
 * Returns true if this URL/hostname should NOT be tracked.
 * Catches internal browser pages, extensions, localhost, blank pages, etc.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function shouldSkipUrl(url) {
  if (!url) return true;
  // Skip internal browser schemes
  for (const scheme of ANALYTICS_SKIP_SCHEMES) {
    if (url.startsWith(scheme)) return true;
  }
  // Skip new-tab pages
  if (url === 'about:blank' || url === 'about:newtab') return true;
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    // Skip empty hostname, localhost, IP addresses (simple heuristic)
    if (!h || h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
    // Skip extension pages
    if (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:') return true;
  } catch {
    return true; // malformed URL
  }
  return false;
}

// ── Storage helpers ────────────────────────────────────────────────────────

/** Returns today's date string in YYYY-MM-DD format. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically adds time to a hostname's analytics record for a given date.
 * Creates new records as needed. Does NOT overwrite existing data.
 *
 * Storage shape:
 * {
 *   "2026-07-15": {
 *     "youtube.com": { seconds: 5421, visits: 8, lastVisited: 1784321451000 }
 *   }
 * }
 *
 * @param {string} hostname  normalized hostname
 * @param {number} seconds   elapsed seconds to add
 * @param {boolean} countVisit  whether to increment visit count
 */
export async function recordTime(hostname, seconds, countVisit = false) {
  if (!hostname || seconds < 1) return;
  const dateKey = today();

  const result = await api.storage.local.get(STORAGE_KEYS.DAILY_ANALYTICS);
  const all = result[STORAGE_KEYS.DAILY_ANALYTICS] || {};
  const dayData = all[dateKey] || {};
  const existing = dayData[hostname] || { seconds: 0, visits: 0, lastVisited: 0 };

  dayData[hostname] = {
    seconds:     existing.seconds + seconds,
    visits:      countVisit ? existing.visits + 1 : existing.visits,
    lastVisited: Date.now(),
  };

  all[dateKey] = dayData;
  await api.storage.local.set({ [STORAGE_KEYS.DAILY_ANALYTICS]: all });
}

/**
 * Returns analytics for a given date, sorted by seconds descending.
 * Defaults to today if no date is provided.
 *
 * @param {string} [date]  YYYY-MM-DD, defaults to today
 * @returns {Array<{ hostname, seconds, visits, lastVisited }>}
 */
export async function getAnalytics(date) {
  const dateKey = date || today();
  const result = await api.storage.local.get(STORAGE_KEYS.DAILY_ANALYTICS);
  const all = result[STORAGE_KEYS.DAILY_ANALYTICS] || {};
  const dayData = all[dateKey] || {};

  return Object.entries(dayData)
    .map(([hostname, data]) => ({ hostname, ...data }))
    .sort((a, b) => b.seconds - a.seconds);
}

// ── Active session management ──────────────────────────────────────────────

/**
 * Flush the currently tracked session to storage.
 * Call this before starting a new session or pausing tracking.
 *
 * @param {boolean} countVisit  whether to also increment visit count on flush
 */
export async function flush(countVisit = false) {
  if (!activeSession) return;
  const elapsed = Math.floor((Date.now() - activeSession.startMs) / 1000);
  if (elapsed >= 1) {
    await recordTime(activeSession.hostname, elapsed, countVisit);
  }
  activeSession = null;
}

/**
 * Start tracking a new tab.
 * Flushes the previous session first if one is active.
 *
 * @param {number} tabId
 * @param {string} url
 * @param {number} windowId
 * @param {boolean} isNewVisit  if true, increments visit count when this session flushes
 */
export async function startTracking(tabId, url, windowId, isNewVisit = false) {
  if (shouldSkipUrl(url)) {
    await flush(false);
    return;
  }

  let hostname;
  try {
    hostname = normalizeHostname(new URL(url).hostname);
  } catch {
    await flush(false);
    return;
  }

  if (!hostname) {
    await flush(false);
    return;
  }

  // Flush previous session (not a new visit — flush accumulates; visit is counted at start)
  await flush(false);

  activeSession = {
    tabId,
    hostname,
    startMs: Date.now(),
    windowId,
    isNewVisit,
  };

  // Count the visit immediately so we don't lose it if the service worker sleeps
  if (isNewVisit) {
    await recordTime(hostname, 0, true);
  }
}

/**
 * Stop tracking entirely (e.g. browser lost focus, service worker shutting down).
 * Flushes any pending time.
 */
export async function stopTracking() {
  await flush(false);
}

/** Returns the current active session (for debugging/testing). */
export function getActiveSession() {
  return activeSession;
}
