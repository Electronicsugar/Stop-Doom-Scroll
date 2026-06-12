/**
 * FocusGuard — Settings Page Controller (ES Module)
 * 
 * Loads user settings from the background service worker on page load,
 * auto-saves any changes immediately, and shows a brief "saved" indicator.
 */

import { MSG, DEFAULT_SETTINGS } from '../lib/constants.js';

const api = (typeof browser !== 'undefined') ? browser : chrome;

// ── DOM References ──────────────────────────────────────────────────────────
const ytBlockShorts  = document.getElementById('yt-block-shorts');
const ytBlockFeed    = document.getElementById('yt-block-feed');
const igBlockReels   = document.getElementById('ig-block-reels');
const igBlockFeed    = document.getElementById('ig-block-feed');
const breakEnabled   = document.getElementById('break-enabled');
const breakMax       = document.getElementById('break-max');
const breakMaxValue  = document.getElementById('break-max-value');
const goalInference  = document.getElementById('goal-inference');
const saveIndicator  = document.getElementById('save-indicator');

/** Handle for the auto-hide timer so we can reset it on rapid changes */
let saveTimeout;

// ── Load Settings ───────────────────────────────────────────────────────────

/**
 * Fetch the current settings from the background and reflect them in the UI.
 * Falls back to DEFAULT_SETTINGS if the message returns nothing.
 */
async function loadSettings() {
  try {
    const settings = await api.runtime.sendMessage({ type: MSG.GET_SETTINGS });
    const s = settings || DEFAULT_SETTINGS;

    ytBlockShorts.checked = s.youtube?.blockShorts  ?? DEFAULT_SETTINGS.youtube.blockShorts;
    ytBlockFeed.checked   = s.youtube?.blockFeed    ?? DEFAULT_SETTINGS.youtube.blockFeed;
    igBlockReels.checked  = s.instagram?.blockReels ?? DEFAULT_SETTINGS.instagram.blockReels;
    igBlockFeed.checked   = s.instagram?.blockFeed  ?? DEFAULT_SETTINGS.instagram.blockFeed;
    breakEnabled.checked  = s.breakButtonEnabled    ?? DEFAULT_SETTINGS.breakButtonEnabled;
    breakMax.value        = s.breakMaxMinutes       ?? DEFAULT_SETTINGS.breakMaxMinutes;
    goalInference.checked = s.goalInferenceEnabled  ?? DEFAULT_SETTINGS.goalInferenceEnabled;

    // Sync the displayed range label
    breakMaxValue.textContent = breakMax.value + ' min';
  } catch (err) {
    console.error('[FocusGuard Settings] Failed to load settings:', err);
  }
}

// ── Save Settings ───────────────────────────────────────────────────────────

/**
 * Collect the current UI state and push it to the background worker.
 */
async function saveSettings() {
  const settings = {
    youtube: {
      blockShorts: ytBlockShorts.checked,
      blockFeed:   ytBlockFeed.checked,
    },
    instagram: {
      blockReels: igBlockReels.checked,
      blockFeed:  igBlockFeed.checked,
    },
    breakButtonEnabled:  breakEnabled.checked,
    breakMaxMinutes:     parseInt(breakMax.value, 10),
    goalInferenceEnabled: goalInference.checked,
  };

  try {
    await api.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings });
    showSaveIndicator();
  } catch (err) {
    console.error('[FocusGuard Settings] Failed to save settings:', err);
  }
}

// ── Save Indicator ──────────────────────────────────────────────────────────

/**
 * Flash the "Settings saved" pill at the bottom of the viewport.
 * Auto-hides after 2 seconds; resets the timer on rapid saves.
 */
function showSaveIndicator() {
  saveIndicator.classList.add('visible');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveIndicator.classList.remove('visible'), 2000);
}

// ── Event Listeners ─────────────────────────────────────────────────────────

// Auto-save whenever any toggle changes
[ytBlockShorts, ytBlockFeed, igBlockReels, igBlockFeed, breakEnabled, goalInference].forEach(el => {
  el.addEventListener('change', saveSettings);
});

// Update displayed value in real-time while dragging the range slider
breakMax.addEventListener('input', () => {
  breakMaxValue.textContent = breakMax.value + ' min';
});

// Persist when the user releases the slider
breakMax.addEventListener('change', saveSettings);

// ── Initialise ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadSettings);
