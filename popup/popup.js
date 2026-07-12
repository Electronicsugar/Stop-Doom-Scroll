/**
 * FocusGuard — Popup Logic (ES Module)
 *
 * Orchestrates the popup UI:  goal prompt → todo list → break captcha →
 * timer picker → break-active countdown.
 *
 * Communicates with the background service worker via chrome.runtime messages.
 */

import { MSG, CAPTCHA_CONFIG } from '../lib/constants.js';

// Cross-browser API handle (Firefox = browser, Chrome = chrome)
const api = (typeof browser !== 'undefined') ? browser : chrome;

// ────────────────────────────────────────────
// DOM REFS — cached once at module load
// ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);


const popupMain       = $('popup-main');
const taskInput       = $('task-input');
const addBtn          = $('add-btn');
const todoList        = $('todo-list');
const todoEmpty       = $('todo-empty');

const breakSection    = $('break-section');
const captchaContainer = $('captcha-container');
const captchaInput    = $('captcha-input');
const captchaVerifyBtn = $('captcha-verify-btn');
const captchaCancelBtn = $('captcha-cancel-btn');
const captchaError    = $('captcha-error');

const breakActiveSection = $('break-active-section');
const ringProgress    = $('ring-progress');
const timerDisplay    = $('timer-display');
const endBreakBtn     = $('end-break-btn');

const popupHeader     = $('popup-header');
const hdrDivider      = $('hdr-divider');
const popupFooter     = $('popup-footer');
const breakBtn        = $('break-btn');
const settingsBtn     = $('settings-btn');
const headerBadges    = $('header-badges');

// Focus Session Controls & Stats
const focusStateBadge = $('focus-state-badge');
const focusCtrlPrimary = $('focus-ctrl-primary');
const statFocused = $('stat-focused');
const statBreaks = $('stat-breaks');
const statStarted = $('stat-started');

const focusPlayPauseBtn = $('focus-play-pause-btn');
const playPauseSwap = $('play-pause-swap');
const focusStopBtn = $('focus-stop-btn');

// ────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────
let currentState = {
  session:  null,
  todos:    [],
  settings: null,
  streak:   null,
};
let captchaText    = '';
let breakInterval  = null;
let totalBreakMs   = 0;      // total break duration so ring % is accurate
let focusInterval  = null;   // setInterval handle for the focus session elapsed timer

// ────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────
async function init() {
  try {
    const res = await sendMessage({ type: MSG.GET_STATE });
    const state = res?.uiState || res;
    if (state) {
      currentState.session  = state.session  ?? null;
      currentState.todos    = state.todos    ?? [];
      currentState.settings = state.settings ?? null;
      currentState.streak   = state.streak   ?? null;
    }
  } catch (err) {
    console.warn('[FocusGuard] Failed to fetch state:', err);
  }
  render();
  setupEventListeners();
  startFocusTimer();
}

// ────────────────────────────────────────────
// RENDER (top-level)
// ────────────────────────────────────────────
function renderSectionsVisibility() {
  const s = currentState.settings;
  const toggleSec = (sec, show) => {
    if (!sec) return;
    sec.style.display = show ? '' : 'none';
    const prev = sec.previousElementSibling;
    if (prev && prev.classList.contains('section-divider')) {
      prev.style.display = show ? '' : 'none';
    }
  };

  toggleSec($('mission-section'), s?.showMission !== false);
  toggleSec($('tasks-section'), s?.showTasks !== false);
  toggleSec($('focus-section'), s?.showFocusSession !== false);
  toggleSec($('streak-card'), s?.showFocusStreak !== false);
}

function render() {
  const s = currentState.session;

  // 1. Break active → show countdown
  if (s && s.breakModeActive && s.breakExpiresAt) {
    showSection('break-active');
    startBreakCountdown();
    return;
  }

  // 2. Default: todo list
  showSection('main');

  if (s && !s.sessionGoal) {
    taskInput.placeholder = 'What is your goal for today?';
  } else {
    taskInput.placeholder = 'Add a task...';
  }

  renderBadges();
  renderTodos();
  renderBreakButton();
  renderStreak();
  renderFocusSession();
  renderSectionsVisibility();
}

// ────────────────────────────────────────────
// BADGES
// ────────────────────────────────────────────
function renderBadges() {
  headerBadges.innerHTML = '';
  const s = currentState.session;
  if (!s) return;

  if (s.chillModeActive) {
    headerBadges.insertAdjacentHTML('beforeend',
      '<span class="badge badge-chill">😌 Chill</span>');
  }
  if (s.breakModeActive) {
    headerBadges.insertAdjacentHTML('beforeend',
      '<span class="badge badge-break">☕ Break</span>');
  }
}

// ────────────────────────────────────────────
// STREAK
// ────────────────────────────────────────────
function renderStreak() {
  const streak = currentState.streak;
  if (!streak) return;

  const streakToday = $('streak-today');
  const streakDistractions = $('streak-distractions');
  const streakLongest = $('streak-longest');
  const streakCurrentVal = $('streak-current-val');

  if (streakToday) streakToday.textContent = Math.round((streak.todayFocusMs || 0) / 60000) + 'm';
  
  if (streakDistractions) {
    streakDistractions.textContent = streak.distractionsBlocked || 0;
  }

  if (streakLongest) streakLongest.textContent = Math.round((streak.longestSessionMs || 0) / 60000) + 'm';
  if (streakCurrentVal) streakCurrentVal.textContent = (streak.currentStreak || 0) + ' days';
}

// ────────────────────────────────────────────
// FOCUS SESSION
// ────────────────────────────────────────────
function renderFocusSession() {
  const s = currentState.session;
  if (!s) return;

  // Stats
  let sessionMs = 0;
  if (s.sessionState !== 'BREAK' && s.focusStartedAt) {
    sessionMs = (Date.now() - s.focusStartedAt) + (s.accumulatedFocusMs || 0);
  } else {
    sessionMs = s.accumulatedFocusMs || 0;
  }
  
  if (statFocused) statFocused.textContent = Math.round(sessionMs / 60000) + 'm';
  if (statBreaks) statBreaks.textContent = s.breakCount || 0;
  
  if (statStarted && s.sessionStartedAt) {
    const d = new Date(s.sessionStartedAt);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    statStarted.textContent = `${h}:${m} ${ampm}`;
  } else if (statStarted) {
    statStarted.textContent = '—';
  }

  // Controls & Badge
  if (focusPlayPauseBtn && focusStateBadge && focusCtrlPrimary) {
    if (s.sessionState === 'PAUSED') {
      if (playPauseSwap) playPauseSwap.classList.add('paused');
      focusPlayPauseBtn.setAttribute('aria-label', 'Resume focus session');
      
      focusStateBadge.className = 'session-badge session-badge--paused';
      focusStateBadge.querySelector('.badge-text').textContent = 'Paused';
    } else {
      if (playPauseSwap) playPauseSwap.classList.remove('paused');
      focusPlayPauseBtn.setAttribute('aria-label', 'Pause focus session');
      
      focusStateBadge.className = 'session-badge session-badge--focusing';
      focusStateBadge.querySelector('.badge-text').textContent = 'Focusing';
    }
  }
}

// ────────────────────────────────────────────
// TODOS
// ────────────────────────────────────────────
function renderTodos() {
  todoList.innerHTML = '';
  const todos = currentState.todos;

  if (!todos || todos.length === 0) {
    todoEmpty.classList.add('active');
    return;
  }

  todoEmpty.classList.remove('active');

  todos.forEach((todo) => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (todo.completed ? ' completed' : '');

    // Checkbox
    const label = document.createElement('label');
    label.className = 'todo-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = todo.completed;
    cb.addEventListener('change', () => handleToggleTodo(todo.id));
    const cm = document.createElement('span');
    cm.className = 'checkmark';
    label.append(cb, cm);

    li.appendChild(label);

    // Goal badge (before text)
    if (todo.isGoal) {
      const badge = document.createElement('span');
      badge.className = 'todo-goal-badge';
      badge.textContent = '⭐ Goal';
      li.appendChild(badge);
    }

    // Text
    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = todo.text;
    span.title = todo.text;
    li.appendChild(span);

    // Delete
    const del = document.createElement('button');
    del.className = 'todo-delete';
    del.title = 'Delete';
    del.textContent = '×';
    del.addEventListener('click', () => handleDeleteTodo(todo.id));
    li.appendChild(del);

    todoList.appendChild(li);
  });
}

// ────────────────────────────────────────────
// BREAK BUTTON VISIBILITY
// ────────────────────────────────────────────
function renderBreakButton() {
  const enabled = currentState.settings?.breakButtonEnabled ?? true;
  breakBtn.style.display = enabled ? '' : 'none';
}



// ────────────────────────────────────────────
// TODO FLOW
// ────────────────────────────────────────────
function handleAddTodo() {
  const text = taskInput.value.trim();
  if (!text) return;

  const s = currentState.session;
  if (s && !s.sessionGoal) {
    sendMessage({ type: MSG.SET_GOAL, goal: text }).then((res) => {
      if (res) {
        currentState.session = res.session ?? currentState.session;
        if (res.todo) {
          currentState.todos.unshift(res.todo);
        }
      }
      taskInput.value = '';
      render();
      taskInput.focus();
    });
  } else {
    sendMessage({ type: MSG.ADD_TODO, text }).then((res) => {
      if (res) {
        currentState.todos = res.todos ?? currentState.todos;
      }
      taskInput.value = '';
      render();
      taskInput.focus();
    });
  }
}

function handleToggleTodo(id) {
  sendMessage({ type: MSG.TOGGLE_TODO, id }).then((res) => {
    if (res) {
      currentState.todos = res.todos ?? currentState.todos;
    }
    render();
  });
}

function handleDeleteTodo(id) {
  sendMessage({ type: MSG.DELETE_TODO, id }).then((res) => {
    if (res) {
      currentState.todos = res.todos ?? currentState.todos;
    }
    render();
  });
}

// ────────────────────────────────────────────
// BREAK FLOW — Step 1: CAPTCHA
// ────────────────────────────────────────────
function showBreakCaptcha() {
  // Length is proportional to break duration
  const breakMins = currentState.settings?.breakMaxMinutes || 10;
  const len = Math.max(5, Math.min(30, breakMins));
  captchaText = '';
  for (let i = 0; i < len; i++) {
    captchaText += CAPTCHA_CONFIG.charset[
      Math.floor(Math.random() * CAPTCHA_CONFIG.charset.length)
    ];
  }

  // Reset input & error
  captchaInput.value = '';
  captchaError.classList.remove('visible');

  // Show section FIRST so captchaContainer has layout dimensions
  showSection('captcha');
  void captchaContainer.offsetWidth;          // force reflow

  // Render canvas (container is now visible & measurable)
  captchaContainer.innerHTML = '';
  captchaContainer.appendChild(generateCaptchaCanvas(captchaText));

  captchaInput.focus();
}

/**
 * Draw a stylised CAPTCHA canvas matching the dark theme.
 * Characters are individually rotated / scaled, with noise dots & bezier lines.
 * Dynamically sizes to fill the container while keeping all characters visible.
 */
function generateCaptchaCanvas(text) {
  const canvas = document.createElement('canvas');

  // --- Measure container to size canvas exactly ---
  const cs = getComputedStyle(captchaContainer);
  const innerW = captchaContainer.clientWidth
    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const W = Math.max(200, Math.floor(innerW) || 254);
  const H = 80;

  // HiDPI: render at device resolution, display at logical size
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const isDark = ThemeManager.getTheme() === 'dark';
  const colors = ThemeManager.tokens.colors[isDark ? 'dark' : 'light'];

  // Background
  ctx.fillStyle = colors.surfaceElevated;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 10);
  ctx.fill();

  // Noise dots
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = colors.border;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H,
            Math.random() * 2 + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Characters: maximize container usage ---
  // 6% horizontal padding each side → ~88% width utilisation
  const hPad    = W * 0.06;
  const usableW = W - hPad * 2;
  const usableH = H * 0.70;                         // 70% of height for glyphs

  // Largest font where every char fits its slot
  // Monospace glyph width ≈ 0.62 × fontSize
  const maxByW   = (usableW / text.length) / 0.62;
  const maxByH   = usableH;
  const baseFont = Math.min(maxByW, maxByH);

  const charSlot = usableW / text.length;            // px per character
  const centerY  = H / 2;

  for (let i = 0; i < text.length; i++) {
    const fontSize = baseFont + (Math.random() * 4 - 2); // ±2px jitter
    ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
    
    // Weighted probabilities: 40% primary, 30% sage, 20% olive, 10% gray-green
    const r = Math.random();
    if (r > 0.9) ctx.fillStyle = '#7D8A79';
    else if (r > 0.7) ctx.fillStyle = '#606F5C';
    else if (r > 0.4) ctx.fillStyle = '#8F9E8B';
    else ctx.fillStyle = colors.textPrimary;

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    const x = hPad + charSlot * (i + 0.5);           // centred in slot
    const y = centerY + (Math.random() * 8 - 4);     // ±4px vertical jitter
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.35);        // ±10° rotation
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  // Noise lines
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = colors.accentLight;
    ctx.lineWidth   = 0.8 + Math.random();
    ctx.beginPath();
    ctx.moveTo(Math.random() * W, Math.random() * H);
    ctx.bezierCurveTo(
      Math.random() * W, Math.random() * H,
      Math.random() * W, Math.random() * H,
      Math.random() * W, Math.random() * H,
    );
    ctx.stroke();
  }

  // Prevent copy / right-click
  canvas.style.userSelect = 'none';
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return canvas;
}

/** Helper: random 0-255 */
function r255() { return Math.floor(Math.random() * 256); }

function verifyCaptcha() {
  const input = captchaInput.value;
  if (input === captchaText) {
    startBreak(currentState.settings.breakMaxMinutes || 10);
  } else {
    captchaError.classList.add('visible');
    captchaInput.value = '';
    captchaInput.focus();
    setTimeout(() => captchaError.classList.remove('visible'), 2000);
  }
}

// ────────────────────────────────────────────
// BREAK FLOW — Step 3: Active countdown
// ────────────────────────────────────────────
function startBreak(minutes) {
  sendMessage({ type: MSG.START_BREAK, minutes }).then((res) => {
    if (res) {
      currentState.session = {
        ...currentState.session,
        breakModeActive: true,
        breakExpiresAt: res.expiresAt,
      };
    }
    totalBreakMs = minutes * 60 * 1000;
    render();                       // render() detects breakModeActive → shows ring
  });
}

function startBreakCountdown() {
  // If we don't know the total yet (popup opened mid-break), estimate it
  if (!totalBreakMs && currentState.session?.breakExpiresAt) {
    const defaultMins = currentState.settings?.breakMaxMinutes || 10;
    totalBreakMs = defaultMins * 60 * 1000;
  }

  // Initial paint
  updateTimerDisplay(
    Math.max(0, currentState.session.breakExpiresAt - Date.now()),
  );

  if (breakInterval) clearInterval(breakInterval);
  breakInterval = setInterval(() => {
    const remaining = currentState.session.breakExpiresAt - Date.now();
    if (remaining <= 0) {
      clearInterval(breakInterval);
      breakInterval = null;
      currentState.session.breakModeActive = false;
      currentState.session.breakExpiresAt  = null;
      totalBreakMs = 0;
      render();
      return;
    }
    updateTimerDisplay(remaining);
  }, 250);                          // 250 ms for smooth ring updates
}

function updateTimerDisplay(remainingMs) {
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  
  const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  timerDisplay.innerHTML = `
    <div style="font-size: 12px; font-weight: 500; opacity: 0.6; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">On Break</div>
    <div>${timeStr}</div>
    <div style="font-size: 11px; opacity: 0.5; margin-top: 2px;">remaining</div>
  `;

  // SVG ring progress
  const circumference = 2 * Math.PI * 54;          // r = 54
  const elapsed  = totalBreakMs - remainingMs;
  const progress = totalBreakMs > 0 ? elapsed / totalBreakMs : 0;
  ringProgress.style.strokeDasharray  = `${circumference}`;
  ringProgress.style.strokeDashoffset = `${circumference * (1 - progress)}`;
}

function endBreakEarly() {
  sendMessage({ type: MSG.END_BREAK }).then(() => {
    if (breakInterval) { clearInterval(breakInterval); breakInterval = null; }
    currentState.session.breakModeActive = false;
    currentState.session.breakExpiresAt  = null;
    totalBreakMs = 0;
    render();
  });
}

// ────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────
function openSettings() {
  api.tabs.create({ url: api.runtime.getURL('settings/settings.html') });
}

// ────────────────────────────────────────────
// SECTION MANAGER
// ────────────────────────────────────────────
const SECTIONS = {
  main:          popupMain,
  captcha:       breakSection,
  'break-active': breakActiveSection,
};

function showSection(name) {
  Object.values(SECTIONS).forEach((el) => el.classList.remove('active'));
  if (SECTIONS[name]) SECTIONS[name].classList.add('active');

  // Header and footer are visible only in the main view
  if (name === 'main') {
    popupHeader.classList.remove('hidden');
    hdrDivider.classList.remove('hidden');
    popupFooter.classList.remove('hidden');
  } else {
    popupHeader.classList.add('hidden');
    hdrDivider.classList.add('hidden');
    popupFooter.classList.add('hidden');
  }
}

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────
function sendMessage(msg) {
  return api.runtime.sendMessage(msg);
}

// ────────────────────────────────────────────
// EVENT LISTENERS
// ────────────────────────────────────────────
function setupEventListeners() {
  // Todos
  addBtn.addEventListener('click', handleAddTodo);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddTodo();
  });

  // Break captcha
  breakBtn.addEventListener('click', showBreakCaptcha);
  captchaVerifyBtn.addEventListener('click', verifyCaptcha);
  captchaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyCaptcha();
  });
  captchaCancelBtn.addEventListener('click', () => showSection('main'));

  // Break active
  endBreakBtn.addEventListener('click', endBreakEarly);

  // Focus Session Controls
  if (focusPlayPauseBtn) {
    focusPlayPauseBtn.addEventListener('click', () => {
      const isPaused = currentState.session?.sessionState === 'PAUSED';
      const msgType = isPaused ? MSG.RESUME_SESSION : MSG.PAUSE_SESSION;
      
      sendMessage({ type: msgType }).then((res) => {
        if (res && res.session) currentState.session = res.session;
        render();
        _tickFocusTimer();
      });
    });
  }
  
  if (focusStopBtn) {
    focusStopBtn.addEventListener('click', () => {
      sendMessage({ type: MSG.RESET_SESSION }).then((res) => {
        if (res && res.session) currentState.session = res.session;
        // also clear todos since it's a new session
        sendMessage({ type: MSG.GET_STATE }).then((state) => {
          const s = state?.uiState || state;
          if (s) {
            currentState.todos = s.todos ?? [];
            currentState.streak = s.streak ?? currentState.streak;
            render();
            _tickFocusTimer();
          }
        });
      });
    });
  }

  // Settings
  settingsBtn.addEventListener('click', openSettings);

  // Stop focus timer when the popup is closed to free the interval
  window.addEventListener('unload', stopFocusTimer);
}

// ────────────────────────────────────────────
// FOCUS SESSION ELAPSED TIMER
// ────────────────────────────────────────────

/**
 * Formats elapsed milliseconds as HH:MM:SS.
 * Returns '--:--:--' when ms is null/undefined (break active).
 */
function formatElapsed(ms) {
  if (ms == null || ms < 0) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0')
  );
}

/** Writes the current elapsed time to #focus-timer-display. */
function _tickFocusTimer() {
  const el = document.getElementById('focus-timer-display');
  if (!el) return;
  const s = currentState.session;
  if (s && s.sessionState === 'PAUSED') {
    // If paused, just display the accumulated focus
    el.textContent = formatElapsed(s.accumulatedFocusMs || 0);
  } else {
    const start = s?.focusStartedAt;
    // Compute elapsed from the stored timestamp every tick — never drifts
    // even if the browser was suspended between ticks.
    let elapsed = null;
    if (start) {
      elapsed = (Date.now() - start) + (s.accumulatedFocusMs || 0);
    } else if (s && s.accumulatedFocusMs) {
      elapsed = s.accumulatedFocusMs;
    }
    el.textContent = formatElapsed(elapsed);
  }
}

/** Starts the focus timer ticker. Clears any existing interval first. */
function startFocusTimer() {
  stopFocusTimer();
  _tickFocusTimer();              // Immediate paint so there's no 1s blank
  focusInterval = setInterval(_tickFocusTimer, 1000);
}

/** Stops the focus timer ticker. */
function stopFocusTimer() {
  if (focusInterval) {
    clearInterval(focusInterval);
    focusInterval = null;
  }
}

// ── Cross-window storage sync ────────────────────────────────────────────────
// When the user triggers a break or ends a break from another popup window
// (or the background alarm fires), the session key changes in storage.
// We listen here so the displayed timer updates immediately without requiring
// the user to close and reopen the popup.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.fg_session) return;

  const newSession = changes.fg_session.newValue;
  if (!newSession) return;

  const prev = currentState.session;
  currentState.session = newSession;

  // If break state changed, re-render the full popup (shows/hides ring countdown)
  if (prev?.breakModeActive !== newSession.breakModeActive ||
      prev?.breakExpiresAt  !== newSession.breakExpiresAt) {
    render();
  }

  // Always update the focus timer display to reflect the new focusStartedAt
  _tickFocusTimer();
});

// ────────────────────────────────────────────
// BOOT
// ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
