/**
 * FocusGuard — Popup Logic (ES Module)
 *
 * Orchestrates the popup UI:  goal prompt → todo list → break captcha →
 * timer picker → break-active countdown.
 *
 * Communicates with the background service worker via chrome.runtime messages.
 */

import { MSG, CAPTCHA_CONFIG, BREAK_TIMER_OPTIONS } from '../lib/constants.js';

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

const timerSection    = $('timer-section');
const timerOptions    = $('timer-options');
const timerCancelBtn  = $('timer-cancel-btn');

const breakActiveSection = $('break-active-section');
const ringProgress    = $('ring-progress');
const timerDisplay    = $('timer-display');
const endBreakBtn     = $('end-break-btn');

const popupFooter     = $('popup-footer');
const breakBtn        = $('break-btn');
const settingsBtn     = $('settings-btn');
const headerBadges    = $('header-badges');

// ────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────
let currentState = {
  session:  null,
  todos:    [],
  settings: null,
};
let captchaText    = '';
let breakInterval  = null;
let totalBreakMs   = 0;      // total break duration so ring % is accurate

// ────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────
async function init() {
  try {
    const state = await sendMessage({ type: MSG.GET_STATE });
    if (state) {
      currentState.session  = state.session  ?? null;
      currentState.todos    = state.todos    ?? [];
      currentState.settings = state.settings ?? null;
    }
  } catch (err) {
    console.warn('[FocusGuard] Failed to fetch state:', err);
  }
  render();
  setupEventListeners();
}

// ────────────────────────────────────────────
// RENDER (top-level)
// ────────────────────────────────────────────
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
  // Generate random CAPTCHA string
  const len = CAPTCHA_CONFIG.minLength +
    Math.floor(Math.random() * (CAPTCHA_CONFIG.maxLength - CAPTCHA_CONFIG.minLength + 1));
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

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 10);
  ctx.fill();

  // Noise dots
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle =
      `rgba(${r255()},${r255()},${r255()},0.15)`;
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
    const hue = 250 + Math.random() * 60;            // purple-blue range
    ctx.fillStyle   = `hsl(${hue}, 70%, 70%)`;
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
    ctx.strokeStyle = `rgba(124, 58, 237, ${0.2 + Math.random() * 0.2})`;
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
    showTimerPicker();
  } else {
    captchaError.classList.add('visible');
    captchaInput.value = '';
    captchaInput.focus();
    setTimeout(() => captchaError.classList.remove('visible'), 2000);
  }
}

// ────────────────────────────────────────────
// BREAK FLOW — Step 2: Timer picker
// ────────────────────────────────────────────
function showTimerPicker() {
  timerOptions.innerHTML = '';

  BREAK_TIMER_OPTIONS.forEach((min) => {
    const btn = document.createElement('button');
    btn.className = 'timer-option-btn';
    btn.innerHTML = `${min}<span class="timer-label">min</span>`;
    btn.addEventListener('click', () => startBreak(min));
    timerOptions.appendChild(btn);
  });

  showSection('timer');
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
    const remaining = currentState.session.breakExpiresAt - Date.now();
    // Best-effort: pick the option closest to remaining time
    const remainingMin = remaining / 60000;
    const closest = BREAK_TIMER_OPTIONS.reduce((prev, cur) =>
      Math.abs(cur - remainingMin) < Math.abs(prev - remainingMin) ? cur : prev
    );
    totalBreakMs = closest * 60 * 1000;
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
  timerDisplay.textContent =
    `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

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
  timer:         timerSection,
  'break-active': breakActiveSection,
};

function showSection(name) {
  Object.values(SECTIONS).forEach((el) => el.classList.remove('active'));
  if (SECTIONS[name]) SECTIONS[name].classList.add('active');

  // Footer is visible only in the main view
  if (name === 'main') {
    popupFooter.classList.remove('hidden');
  } else {
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

  // Timer picker
  timerCancelBtn.addEventListener('click', () => showSection('main'));

  // Break active
  endBreakBtn.addEventListener('click', endBreakEarly);

  // Settings
  settingsBtn.addEventListener('click', openSettings);
}

// ────────────────────────────────────────────
// BOOT
// ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
