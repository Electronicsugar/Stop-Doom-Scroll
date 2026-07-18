/**
 * FocusGuard — Settings Page Controller (ES Module)
 *
 * Loads user settings from the background service worker on page load,
 * auto-saves any changes immediately, and shows a brief "saved" indicator.
 *
 * Settings Lock:
 * - Protected settings are marked with data-lock-protected on their .setting-row.
 * - When locked, any attempt to change a protected toggle is intercepted and
 *   the unlock dialog is shown. The toggle change is reverted immediately.
 * - Auth state (15-minute timeout) lives in the background service worker.
 * - Only one dialog is ever visible at a time.
 */

import { MSG, DEFAULT_SETTINGS } from '../lib/constants.js';
import { validatePassword, calculatePasswordStrength, PASSWORD_RULES } from '../lib/password.js';

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
const autoChill      = document.getElementById('auto-chill');
const showMission    = document.getElementById('show-mission');
const showTasks      = document.getElementById('show-tasks');
const showFocusSession = document.getElementById('show-focus-session');
const showFocusStreak  = document.getElementById('show-focus-streak');
const breakDurationRow = document.getElementById('break-duration-row');
const breakDurationSlider = document.getElementById('break-duration-slider');
const focusReminder    = document.getElementById('focus-reminder');
const reminderInterval = document.getElementById('reminder-interval');
const reminderIntervalValue = document.getElementById('reminder-interval-value');
const focusReminderContainer = document.getElementById('focus-reminder-container');
const reminderIntervalRow = document.getElementById('reminder-interval-row');
const reminderIntervalSlider = document.getElementById('reminder-interval-slider');
const saveIndicator  = document.getElementById('save-indicator');

// Lock section elements
const lockEnabled      = document.getElementById('lock-enabled');
const lockManageRow    = document.getElementById('lock-manage-row');
const lockManageBtn    = document.getElementById('lock-manage-btn');
const lockStatusText   = document.getElementById('lock-status-text');

// ── Lock dialog stacking guard ───────────────────────────────────────────────
// Only one dialog may ever be visible. Track the active overlay here.
let activeOverlay = null;

function showOverlay(id) {
  if (activeOverlay) return; // prevent stacking
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  activeOverlay = el;
  // Focus first input or button
  setTimeout(() => {
    const firstInput = el.querySelector('input, button:not(.lock-eye-btn)');
    if (firstInput) firstInput.focus();
  }, 60);
}

function hideOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'none';
  if (activeOverlay === el) activeOverlay = null;
}

// Close any dialog when Escape is pressed
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeOverlay) {
    // cancel button if present, otherwise hide
    const cancel = activeOverlay.querySelector('[id$="-cancel-btn"], [id$="-close-btn"]');
    if (cancel) cancel.click();
    else {
      activeOverlay.style.display = 'none';
      activeOverlay = null;
    }
  }
});

// ── Visibility helpers ───────────────────────────────────────────────────────

function toggleBreakSettingsVisibility() {
  const isEnabled = breakEnabled.checked;
  if (breakDurationRow) breakDurationRow.style.display = isEnabled ? '' : 'none';
  if (breakDurationSlider) breakDurationSlider.style.display = isEnabled ? '' : 'none';
}

function toggleReminderSettingsVisibility() {
  const autoChillEnabled = autoChill.checked;
  const reminderEnabled = focusReminder.checked;

  if (focusReminderContainer) {
    focusReminderContainer.style.display = autoChillEnabled ? '' : 'none';
  }
  if (reminderIntervalRow) {
    reminderIntervalRow.style.display = (autoChillEnabled && reminderEnabled) ? '' : 'none';
  }
  if (reminderIntervalSlider) {
    reminderIntervalSlider.style.display = (autoChillEnabled && reminderEnabled) ? '' : 'none';
  }
}

/** Handle for the auto-hide timer so we can reset it on rapid changes */
let saveTimeout;

// ── Slider fill helpers ──────────────────────────────────────────────────────

function updateSliderFill() {
  const min = parseFloat(breakMax.min) || 1;
  const max = parseFloat(breakMax.max) || 30;
  const val = parseFloat(breakMax.value) || 10;
  const percentage = ((val - min) / (max - min)) * 100;
  breakMax.style.setProperty('--fill', `${percentage}%`);
}

function updateReminderSliderFill() {
  if (!reminderInterval) return;
  const min = parseFloat(reminderInterval.min) || 5;
  const max = parseFloat(reminderInterval.max) || 60;
  const val = parseFloat(reminderInterval.value) || 25;
  const percentage = ((val - min) / (max - min)) * 100;
  reminderInterval.style.setProperty('--fill', `${percentage}%`);
}

// ── Load Settings ────────────────────────────────────────────────────────────

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

    updateSliderFill();

    goalInference.checked = s.goalInferenceEnabled  ?? DEFAULT_SETTINGS.goalInferenceEnabled;
    autoChill.checked     = s.autoChillEnabled      ?? DEFAULT_SETTINGS.autoChillEnabled;
    showMission.checked   = s.showMission           ?? DEFAULT_SETTINGS.showMission;
    showTasks.checked     = s.showTasks             ?? DEFAULT_SETTINGS.showTasks;
    showFocusSession.checked = s.showFocusSession   ?? DEFAULT_SETTINGS.showFocusSession;
    showFocusStreak.checked  = s.showFocusStreak    ?? DEFAULT_SETTINGS.showFocusStreak;
    focusReminder.checked = s.focusReminderEnabled  ?? DEFAULT_SETTINGS.focusReminderEnabled;
    reminderInterval.value = s.reminderInterval     ?? DEFAULT_SETTINGS.reminderInterval;

    toggleBreakSettingsVisibility();
    toggleReminderSettingsVisibility();
    updateReminderSliderFill();

    breakMaxValue.textContent = breakMax.value + ' min';
    if (reminderIntervalValue) reminderIntervalValue.textContent = reminderInterval.value + ' min';
  } catch (err) {
    console.error('[FocusGuard Settings] Failed to load settings:', err);
  }

  // Load lock status and apply protection state
  await loadLockStatus();
}

// ── Save Settings ────────────────────────────────────────────────────────────

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
    autoChillEnabled:     autoChill.checked,
    showMission:          showMission.checked,
    showTasks:            showTasks.checked,
    showFocusSession:     showFocusSession.checked,
    showFocusStreak:      showFocusStreak.checked,
    focusReminderEnabled: focusReminder.checked,
    reminderInterval:     parseInt(reminderInterval.value, 10),
  };

  try {
    await api.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings });
    showSaveIndicator();
  } catch (err) {
    console.error('[FocusGuard Settings] Failed to save settings:', err);
  }

  toggleBreakSettingsVisibility();
  toggleReminderSettingsVisibility();
}

// ── Save Indicator ───────────────────────────────────────────────────────────

function showSaveIndicator() {
  saveIndicator.classList.add('visible');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveIndicator.classList.remove('visible'), 2000);
}

// ── Event Listeners (non-lock) ───────────────────────────────────────────────

[ytBlockShorts, ytBlockFeed, igBlockReels, igBlockFeed, breakEnabled, goalInference, autoChill, showMission, showTasks, showFocusSession, showFocusStreak, focusReminder].forEach(el => {
  el.addEventListener('change', saveSettings);
});

breakMax.addEventListener('input', () => {
  breakMaxValue.textContent = breakMax.value + ' min';
  updateSliderFill();
});
breakMax.addEventListener('change', saveSettings);

if (reminderInterval) {
  reminderInterval.addEventListener('input', () => {
    if (reminderIntervalValue) reminderIntervalValue.textContent = reminderInterval.value + ' min';
    updateReminderSliderFill();
  });
  reminderInterval.addEventListener('change', saveSettings);
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS LOCK SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// ── Lock state ───────────────────────────────────────────────────────────────

/** Whether the lock is currently enabled (per background) */
let lockIsEnabled = false;
/** Whether the current page session is authenticated (verified with background on load/restore) */
let lockIsAuthenticated = false;
/** Current delay (seconds) from lock config */
let lockUnlockDelay = 0;
/** Pending action: function to call after successful unlock */
let pendingUnlockAction = null;
/** Delay countdown interval handle */
let delayIntervalHandle = null;

// ── Load & Apply Lock Status ─────────────────────────────────────────────────

async function loadLockStatus() {
  try {
    const status = await api.runtime.sendMessage({ type: MSG.LOCK_GET_STATUS });
    lockIsEnabled = status?.enabled ?? false;
    lockIsAuthenticated = status?.isAuthenticated ?? false;
    lockUnlockDelay = status?.unlockDelay ?? 0;
    applyLockUI();
    applyProtectedSettings();
    // Sync radio buttons to current delay
    syncDelayRadios(lockUnlockDelay);
  } catch (err) {
    console.warn('[FocusGuard Lock] Failed to load lock status:', err);
  }
}

/**
 * Reflects the lock enabled/disabled state in the Security section UI.
 */
function applyLockUI() {
  lockEnabled.checked = lockIsEnabled;
  if (lockManageRow) lockManageRow.style.display = lockIsEnabled ? '' : 'none';
  if (lockStatusText) {
    lockStatusText.textContent = lockIsAuthenticated ? 'Enabled · Unlocked' : 'Enabled';
  }
}

/**
 * Marks all [data-lock-protected] rows as locked/unlocked.
 * When locked, the row gets data-locked attribute for CSS indicator.
 */
function applyProtectedSettings() {
  const protectedRows = document.querySelectorAll('[data-lock-protected]');
  protectedRows.forEach(row => {
    if (lockIsEnabled && !lockIsAuthenticated) {
      row.setAttribute('data-locked', '');
    } else {
      row.removeAttribute('data-locked');
    }
  });
}

// ── Protected toggle interception ────────────────────────────────────────────

/**
 * Intercepts changes to any [data-lock-protected] checkbox.
 * If locked, immediately reverts the change and shows the unlock dialog.
 */
function interceptProtectedChange(event) {
  if (!lockIsEnabled || lockIsAuthenticated) return; // not locked — allow through
  if (event.isTrusted === false) return;              // programmatic change (our revert) — ignore

  const checkbox = event.target;
  // Revert immediately before the UI updates
  checkbox.checked = !checkbox.checked;
  event.preventDefault();
  event.stopImmediatePropagation();

  // Queue this change to execute after successful unlock
  const targetChecked = !checkbox.checked; // what the user wanted
  pendingUnlockAction = () => {
    checkbox.checked = targetChecked;
    saveSettings();
  };

  startUnlockFlow();
}

// Attach interceptors to all lock-protected checkboxes
document.querySelectorAll('[data-lock-protected] input[type="checkbox"]').forEach(checkbox => {
  checkbox.addEventListener('change', interceptProtectedChange, true); // capture phase
});

// ── Lock toggle (Security section) ───────────────────────────────────────────

lockEnabled.addEventListener('change', async () => {
  if (activeOverlay) {
    // Don't respond to programmatic revert
    return;
  }

  if (lockEnabled.checked && !lockIsEnabled) {
    // User is enabling the lock — show setup dialog
    lockEnabled.checked = false; // revert until setup completes
    showSetupDialog();
  } else if (!lockEnabled.checked && lockIsEnabled) {
    // User is disabling the lock — require authentication
    lockEnabled.checked = true; // revert until authenticated
    pendingUnlockAction = () => disableLock();
    startUnlockFlow();
  }
});

// ── Lock Setup Dialog ─────────────────────────────────────────────────────────

function showSetupDialog() {
  // Reset state
  const step1 = document.getElementById('lock-setup-step1');
  const step2 = document.getElementById('lock-setup-step2');
  const pw1 = document.getElementById('lock-setup-password');
  const pw2 = document.getElementById('lock-setup-confirm');
  const errEl = document.getElementById('lock-setup-error');
  if (step1) step1.style.display = '';
  if (step2) step2.style.display = 'none';
  if (pw1) pw1.value = '';
  if (pw2) pw2.value = '';
  if (errEl) errEl.style.display = 'none';
  showOverlay('lock-setup-overlay');
}

// Step 1: Continue button
document.getElementById('lock-setup-continue-btn')?.addEventListener('click', () => {
  document.getElementById('lock-setup-step1').style.display = 'none';
  document.getElementById('lock-setup-step2').style.display = '';
  setTimeout(() => document.getElementById('lock-setup-password')?.focus(), 60);
});

// Step 1: Cancel
document.getElementById('lock-setup-cancel-btn')?.addEventListener('click', () => {
  hideOverlay('lock-setup-overlay');
});

// Step 2: Back
document.getElementById('lock-setup-back-btn')?.addEventListener('click', () => {
  document.getElementById('lock-setup-step1').style.display = '';
  document.getElementById('lock-setup-step2').style.display = 'none';
});

// Step 2: Enable Lock
document.getElementById('lock-setup-enable-btn')?.addEventListener('click', async () => {
  const pw1 = document.getElementById('lock-setup-password')?.value;
  const pw2 = document.getElementById('lock-setup-confirm')?.value;
  const errEl = document.getElementById('lock-setup-error');

  // Use generic messages for mismatch, but specific for validation
  const val = validatePassword(pw1);
  if (!val.isValid) {
    const failedRule = val.ruleStatus.find(r => r.required && !r.passed);
    if (failedRule) {
      showLockError(errEl, `Missing requirement: ${failedRule.label}`);
    } else {
      showLockError(errEl, 'Please enter a stronger password.');
    }
    document.getElementById('lock-setup-password')?.focus();
    return;
  }
  if (pw1 !== pw2) {
    showLockError(errEl, 'The entries do not match. Please try again.');
    return;
  }

  try {
    const res = await api.runtime.sendMessage({ type: MSG.LOCK_SETUP, password: pw1 });
    if (res?.success) {
      hideOverlay('lock-setup-overlay');
      await loadLockStatus();
      showSaveIndicator();
    } else {
      showLockError(errEl, 'Something went wrong. Please try again.');
    }
  } catch {
    showLockError(errEl, 'Something went wrong. Please try again.');
  }
});

// Password eye toggles for setup
setupEyeToggle('lock-setup-eye1', 'lock-setup-password');
setupEyeToggle('lock-setup-eye2', 'lock-setup-confirm');

// ── Unlock Flow ───────────────────────────────────────────────────────────────

/**
 * Starts the unlock flow:
 * 1. If unlock delay > 0: show countdown overlay first, then show password dialog.
 * 2. Otherwise: show password dialog directly.
 */
function startUnlockFlow() {
  if (lockUnlockDelay > 0) {
    showDelayCountdown(lockUnlockDelay, () => showUnlockDialog());
  } else {
    showUnlockDialog();
  }
}

function showUnlockDialog() {
  const pw = document.getElementById('lock-unlock-password');
  const errEl = document.getElementById('lock-unlock-error');
  const cooldownEl = document.getElementById('lock-cooldown-msg');
  if (pw) pw.value = '';
  if (errEl) errEl.style.display = 'none';
  if (cooldownEl) cooldownEl.style.display = 'none';
  showOverlay('lock-unlock-overlay');
}

// Unlock: Cancel
document.getElementById('lock-unlock-cancel-btn')?.addEventListener('click', () => {
  pendingUnlockAction = null;
  hideOverlay('lock-unlock-overlay');
});

// Unlock: Confirm
document.getElementById('lock-unlock-confirm-btn')?.addEventListener('click', async () => {
  const pw = document.getElementById('lock-unlock-password')?.value;
  const errEl = document.getElementById('lock-unlock-error');
  const cooldownEl = document.getElementById('lock-cooldown-msg');
  if (!pw) return;

  try {
    const res = await api.runtime.sendMessage({ type: MSG.LOCK_VERIFY, password: pw });

    if (res?.success) {
      lockIsAuthenticated = true;
      hideOverlay('lock-unlock-overlay');
      applyLockUI();
      applyProtectedSettings();
      // Execute the pending action (the setting change the user wanted)
      if (pendingUnlockAction) {
        pendingUnlockAction();
        pendingUnlockAction = null;
      }
    } else if (res?.locked) {
      // Lockout active
      if (errEl) errEl.style.display = 'none';
      startCooldownDisplay(cooldownEl, res.lockoutRemainingMs);
    } else {
      // Wrong password — use generic message
      const remaining = res?.attemptsRemaining;
      const msg = (remaining !== undefined && remaining > 0)
        ? `Incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Incorrect password.';
      showLockError(errEl, msg);
      if (cooldownEl) cooldownEl.style.display = 'none';
    }
  } catch {
    showLockError(errEl, 'Something went wrong. Please try again.');
  }
});

// Unlock password eye toggle
setupEyeToggle('lock-unlock-eye', 'lock-unlock-password');

// Enter key to submit unlock
document.getElementById('lock-unlock-password')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('lock-unlock-confirm-btn')?.click();
});

// ── Cooldown display (live countdown) ────────────────────────────────────────

function startCooldownDisplay(el, remainingMs) {
  if (!el) return;
  el.style.display = '';
  let secsLeft = Math.ceil(remainingMs / 1000);

  function update() {
    if (secsLeft <= 0) {
      el.textContent = 'Lockout expired. Try again.';
      return;
    }
    const m = Math.floor(secsLeft / 60);
    const s = secsLeft % 60;
    el.textContent = `Too many incorrect attempts. Try again in ${m > 0 ? m + 'm ' : ''}${s}s.`;
    secsLeft--;
  }
  update();
  const interval = setInterval(() => {
    update();
    if (secsLeft < 0) clearInterval(interval);
  }, 1000);
}

// ── Unlock Delay Countdown Overlay ───────────────────────────────────────────

/**
 * Shows the delay countdown overlay, then calls onComplete when done.
 * Cancelling clears the timer and discards the pending action.
 */
function showDelayCountdown(seconds, onComplete) {
  let remaining = seconds;
  const countdownEl = document.getElementById('lock-delay-countdown');
  if (countdownEl) countdownEl.textContent = remaining;
  showOverlay('lock-delay-overlay');

  delayIntervalHandle = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(delayIntervalHandle);
      delayIntervalHandle = null;
      hideOverlay('lock-delay-overlay');
      onComplete();
    }
  }, 1000);
}

document.getElementById('lock-delay-cancel-btn')?.addEventListener('click', () => {
  if (delayIntervalHandle) {
    clearInterval(delayIntervalHandle);
    delayIntervalHandle = null;
  }
  pendingUnlockAction = null;
  hideOverlay('lock-delay-overlay');
});

// ── Manage Dialog ─────────────────────────────────────────────────────────────

lockManageBtn?.addEventListener('click', () => {
  // Clear password field each time
  const pw = document.getElementById('lock-manage-password');
  const errEl = document.getElementById('lock-manage-error');
  if (pw) pw.value = '';
  if (errEl) errEl.style.display = 'none';
  syncDelayRadios(lockUnlockDelay);
  showOverlay('lock-manage-overlay');
});

// Manage: Save (delay update requires active auth session)
document.getElementById('lock-manage-save-btn')?.addEventListener('click', async () => {
  const selectedDelay = parseInt(
    document.querySelector('input[name="unlock-delay"]:checked')?.value || '0', 10
  );
  try {
    const res = await api.runtime.sendMessage({
      type: MSG.LOCK_UPDATE_DELAY,
      delaySeconds: selectedDelay,
    });
    if (res?.success) {
      lockUnlockDelay = selectedDelay;
      hideOverlay('lock-manage-overlay');
      showSaveIndicator();
    } else {
      // Not authenticated — need to verify before saving delay
      const errEl = document.getElementById('lock-manage-error');
      showLockError(errEl, 'Please verify your password first.');
    }
  } catch {
    const errEl = document.getElementById('lock-manage-error');
    showLockError(errEl, 'Something went wrong.');
  }
});

// Manage: Close
document.getElementById('lock-manage-close-btn')?.addEventListener('click', () => {
  hideOverlay('lock-manage-overlay');
});

// Manage: Disable Lock
document.getElementById('lock-disable-btn')?.addEventListener('click', async () => {
  const pw = document.getElementById('lock-manage-password')?.value;
  const errEl = document.getElementById('lock-manage-error');
  if (!pw) {
    showLockError(errEl, 'Please enter your password to disable the lock.');
    return;
  }
  await disableLockWithPassword(pw, errEl);
});

// Manage: Change Password — opens the change-password dialog
document.getElementById('lock-change-pw-btn')?.addEventListener('click', () => {
  const c1 = document.getElementById('lock-change-current');
  const c2 = document.getElementById('lock-change-new');
  const c3 = document.getElementById('lock-change-confirm');
  const errEl = document.getElementById('lock-change-error');
  if (c1) c1.value = '';
  if (c2) c2.value = '';
  if (c3) c3.value = '';
  if (errEl) errEl.style.display = 'none';
  hideOverlay('lock-manage-overlay');
  showOverlay('lock-change-pw-overlay');
});

setupEyeToggle('lock-manage-eye', 'lock-manage-password');

// ── Disable Lock ──────────────────────────────────────────────────────────────

async function disableLock() {
  // This is called when unlocking via the main toggle — user already authenticated.
  // We still require the password from the manage dialog.
  // Open manage dialog to confirm.
  pendingUnlockAction = null;
  lockManageBtn?.click();
}

async function disableLockWithPassword(password, errEl) {
  try {
    const res = await api.runtime.sendMessage({ type: MSG.LOCK_DISABLE, password });
    if (res?.success) {
      lockIsEnabled = false;
      lockIsAuthenticated = false;
      hideOverlay('lock-manage-overlay');
      applyLockUI();
      applyProtectedSettings();
      showSaveIndicator();
    } else if (res?.locked) {
      startCooldownDisplay(errEl, res.lockoutRemainingMs);
    } else {
      showLockError(errEl, 'Incorrect password.');
    }
  } catch {
    showLockError(errEl, 'Something went wrong.');
  }
}

// ── Change Password Dialog ────────────────────────────────────────────────────

document.getElementById('lock-change-cancel-btn')?.addEventListener('click', () => {
  hideOverlay('lock-change-pw-overlay');
  showOverlay('lock-manage-overlay');
});

document.getElementById('lock-change-confirm-btn')?.addEventListener('click', async () => {
  const current = document.getElementById('lock-change-current')?.value;
  const newPw   = document.getElementById('lock-change-new')?.value;
  const confirm = document.getElementById('lock-change-confirm')?.value;
  const errEl   = document.getElementById('lock-change-error');

  if (!current || !newPw || !confirm) {
    showLockError(errEl, 'All fields are required.');
    return;
  }
  const val = validatePassword(newPw);
  if (!val.isValid) {
    const failedRule = val.ruleStatus.find(r => r.required && !r.passed);
    if (failedRule) {
      showLockError(errEl, `Missing requirement: ${failedRule.label}`);
    } else {
      showLockError(errEl, 'Please choose a stronger password.');
    }
    document.getElementById('lock-change-new')?.focus();
    return;
  }
  if (newPw !== confirm) {
    showLockError(errEl, 'The entries do not match. Please try again.');
    return;
  }

  try {
    const res = await api.runtime.sendMessage({
      type: MSG.LOCK_CHANGE_PASSWORD,
      currentPassword: current,
      newPassword: newPw,
    });
    if (res?.success) {
      hideOverlay('lock-change-pw-overlay');
      showSaveIndicator();
    } else {
      // Generic message — don't reveal which field was wrong
      showLockError(errEl, 'Could not change password. Please try again.');
    }
  } catch {
    showLockError(errEl, 'Something went wrong.');
  }
});

setupEyeToggle('lock-change-eye1', 'lock-change-current');
setupEyeToggle('lock-change-eye2', 'lock-change-new');
setupEyeToggle('lock-change-eye3', 'lock-change-confirm');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Displays an error message inside a lock dialog.
 * @param {HTMLElement|null} el
 * @param {string} msg
 */
function showLockError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

/**
 * Wires a password eye-toggle button to its input field.
 * @param {string} btnId
 * @param {string} inputId
 */
function setupEyeToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (!btn || !inp) return;
  btn.addEventListener('click', () => {
    const isPassword = inp.type === 'password';
    inp.type = isPassword ? 'text' : 'password';
    // Swap icon: open eye when text visible
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    const path = btn.querySelector('path');
    if (path) {
      if (isPassword) {
        // Eye-off icon
        path.setAttribute('d', 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24');
        // Add slash line
        const line = btn.querySelector('line') || document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '1'); line.setAttribute('y1', '1');
        line.setAttribute('x2', '23'); line.setAttribute('y2', '23');
        btn.querySelector('svg')?.appendChild(line);
      } else {
        path.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
        const line = btn.querySelector('line');
        if (line) line.remove();
      }
    }
  });
}

/**
 * Syncs the unlock-delay radio buttons to the current delay value.
 * @param {number} delaySeconds
 */
function syncDelayRadios(delaySeconds) {
  const radios = document.querySelectorAll('input[name="unlock-delay"]');
  radios.forEach(r => {
    r.checked = parseInt(r.value, 10) === delaySeconds;
  });
  // Default to "Off" if none match
  if (![...radios].some(r => r.checked)) {
    const offRadio = document.getElementById('delay-off');
    if (offRadio) offRadio.checked = true;
  }
}

// ── Back button ──────────────────────────────────────────────────────────────

document.getElementById('back-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.close();
});

// ── Initialise ───────────────────────────────────────────────────────────────

// ── Password Validation UI ──────────────────────────────────────────────────

function renderPasswordRequirements(listElement) {
  if (!listElement) return;
  listElement.innerHTML = '';
  PASSWORD_RULES.forEach(rule => {
    const li = document.createElement('li');
    li.dataset.ruleId = rule.id;
    li.textContent = rule.label;
    listElement.appendChild(li);
  });
}

const setupPwList = document.querySelector('#setup-pw-requirements .pw-rules-list');
const changePwList = document.querySelector('#change-pw-requirements .pw-rules-list');
renderPasswordRequirements(setupPwList);
renderPasswordRequirements(changePwList);

function handlePasswordInput(inputEl, requirementsEl) {
  if (!requirementsEl) return;
  const pw = inputEl.value;
  if (!pw) {
    requirementsEl.style.display = 'none';
    return;
  }
  requirementsEl.style.display = 'block';

  const { ruleStatus } = validatePassword(pw);
  const strength = calculatePasswordStrength(pw);

  const listItems = requirementsEl.querySelectorAll('.pw-rules-list li');
  listItems.forEach(li => {
    const status = ruleStatus.find(r => r.id === li.dataset.ruleId);
    if (status && status.passed) {
      li.classList.add('passed');
    } else {
      li.classList.remove('passed');
    }
  });

  const strengthContainer = requirementsEl.querySelector('.pw-strength-container');
  const strengthLabel = requirementsEl.querySelector('.pw-strength-label');
  if (strengthContainer) strengthContainer.dataset.strength = strength;
  if (strengthLabel) strengthLabel.textContent = strength;
}

document.getElementById('lock-setup-password')?.addEventListener('input', (e) => {
  handlePasswordInput(e.target, document.getElementById('setup-pw-requirements'));
});

document.getElementById('lock-change-new')?.addEventListener('input', (e) => {
  handlePasswordInput(e.target, document.getElementById('change-pw-requirements'));
});

document.addEventListener('DOMContentLoaded', loadSettings);
