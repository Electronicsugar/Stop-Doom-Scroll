/**
 * FocusGuard — Settings UI Init (Visual Only)
 *
 * Handles purely visual UI for the settings page:
 *  - Theme loading on startup + two-dot theme picker interaction
 *  - Tip of the Day daily rotation
 *  - Break duration slider live update
 *  - Reminder interval slider live update
 *
 * This file does NOT modify any settings.js logic or storage keys.
 */

(function () {
  'use strict';

  // ── Back button — close the settings tab (replaces inline onclick removed for MV3 CSP) ──
  var backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.close();
    });
  }

  // ── Theme: load immediately and wire up the two-dot picker ───────────────
  function syncThemeUI(theme) {
    var lightBtn  = document.getElementById('theme-dot-light');
    var darkBtn   = document.getElementById('theme-dot-dark');
    var labelEl   = document.getElementById('theme-label');
    var legacyChk = document.getElementById('theme-toggle');

    if (theme === 'dark') {
      if (lightBtn)  { lightBtn.classList.remove('active'); lightBtn.setAttribute('aria-pressed', 'false'); }
      if (darkBtn)   { darkBtn.classList.add('active');     darkBtn.setAttribute('aria-pressed', 'true');  }
      if (labelEl)   labelEl.textContent  = 'Dark';
      if (legacyChk) legacyChk.checked   = true;
    } else {
      if (lightBtn)  { lightBtn.classList.add('active');    lightBtn.setAttribute('aria-pressed', 'true');  }
      if (darkBtn)   { darkBtn.classList.remove('active'); darkBtn.setAttribute('aria-pressed', 'false'); }
      if (labelEl)   labelEl.textContent  = 'Light';
      if (legacyChk) legacyChk.checked   = false;
    }
  }

  // Load saved theme and apply it
  if (typeof FocusGuardTheme !== 'undefined') {
    FocusGuardTheme.load(function (theme) {
      syncThemeUI(theme);
    });
  }

  // Wire up the two dot buttons
  var lightBtn = document.getElementById('theme-dot-light');
  var darkBtn  = document.getElementById('theme-dot-dark');

  if (lightBtn) {
    lightBtn.addEventListener('click', function () {
      if (typeof FocusGuardTheme !== 'undefined') FocusGuardTheme.set('light');
      syncThemeUI('light');
    });
  }

  if (darkBtn) {
    darkBtn.addEventListener('click', function () {
      if (typeof FocusGuardTheme !== 'undefined') FocusGuardTheme.set('dark');
      syncThemeUI('dark');
    });
  }

  // Legacy checkbox still triggers sync (in case anything reads it)
  var legacyChk = document.getElementById('theme-toggle');
  if (legacyChk) {
    legacyChk.addEventListener('change', function () {
      var theme = this.checked ? 'dark' : 'light';
      if (typeof FocusGuardTheme !== 'undefined') FocusGuardTheme.set(theme);
      syncThemeUI(theme);
    });
  }

  // ── Tip of the Day ────────────────────────────────────────────────────────
  var TIPS = [
    { text: 'The secret of getting ahead\nis getting started.',           author: '— Mark Twain'  },
    { text: 'Small daily improvements\nare the key to staggering results.', author: '— Unknown'  },
    { text: 'Block the feed, not\nyour creativity.',                       author: '— Sage' },
    { text: 'Distraction is the enemy\nof deep work.',                     author: '— Cal Newport' },
    { text: 'Take breaks intentionally,\nnot by default.',                 author: '— Sage' },
    { text: 'The cost of distraction\nis compounded daily.',               author: '— Unknown'    },
    { text: 'Your attention is\nyour most valuable asset.',                author: '— Unknown'    },
  ];

  var now  = new Date();
  var seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  var tip  = TIPS[seed % TIPS.length];

  var tEl = document.getElementById('tip-text');
  var aEl = document.getElementById('tip-author');
  if (tEl) tEl.innerHTML  = tip.text.replace(/\n/g, '<br>');
  if (aEl) aEl.textContent = tip.author;

  // ── Break duration slider live update ─────────────────────────────────────
  var breakSlider = document.getElementById('break-max');
  var breakVal    = document.getElementById('break-max-value');

  function updateBreakFill() {
    if (!breakSlider || !breakVal) return;
    var min = parseFloat(breakSlider.min) || 1;
    var max = parseFloat(breakSlider.max) || 30;
    var val = parseFloat(breakSlider.value) || 10;
    var pct = ((val - min) / (max - min)) * 100;
    breakSlider.style.setProperty('--fill', pct + '%');
    breakVal.textContent = val + ' min';
  }

  if (breakSlider) {
    breakSlider.addEventListener('input', updateBreakFill);
    updateBreakFill();
  }

  // ── Reminder interval slider live update ──────────────────────────────────
  var reminderSlider = document.getElementById('reminder-interval');
  var reminderVal    = document.getElementById('reminder-interval-value');

  function updateReminderFill() {
    if (!reminderSlider || !reminderVal) return;
    var min = parseFloat(reminderSlider.min) || 5;
    var max = parseFloat(reminderSlider.max) || 60;
    var val = parseFloat(reminderSlider.value) || 25;
    var pct = ((val - min) / (max - min)) * 100;
    reminderSlider.style.setProperty('--fill', pct + '%');
    reminderVal.textContent = val + ' min';
  }

  if (reminderSlider) {
    reminderSlider.addEventListener('input', updateReminderFill);
    updateReminderFill();
  }

})();
