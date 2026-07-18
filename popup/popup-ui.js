/**
 * FocusGuard — Popup UI Init (Visual Only)
 *
 * Handles purely visual UI updates:
 *  - Theme loading (light/dark) on startup
 *  - Date display (day name, number, month/year)
 *  - Daily motivational quote on sticky note
 *  - Task count sync via MutationObserver
 *  - Break CTA description from storage
 *
 *  NOTE: The focus session elapsed timer (#focus-timer-display) is driven
 *  by popup.js, which reads session.focusStartedAt from storage.
 *  This file does not own that timer.
 *
 * This file does NOT touch extension state, messaging, or any popup.js logic.
 */

(function () {
  'use strict';

  // ── Theme: load immediately to prevent flash ──────────────────────────────
  // ThemeManager is provided by lib/theme.js and initializes automatically.

  // ── Date display ──────────────────────────────────────────────────────────
  var DAYS   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  var MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  var now    = new Date();

  var dayEl = document.getElementById('date-day-name');
  var numEl = document.getElementById('date-num');
  var myEl  = document.getElementById('date-month-year');

  if (dayEl) dayEl.textContent = DAYS[now.getDay()];
  if (numEl) numEl.textContent = String(now.getDate()).padStart(2, '0');
  if (myEl)  myEl.textContent  = MONTHS[now.getMonth()] + ' ' + now.getFullYear();

  // ── Motivational quotes ───────────────────────────────────────────────────
  var QUOTES = [
    { text: 'Discipline today,\nfreedom tomorrow.',          author: '— Unknown'      },
    { text: 'Focus is the art of\nknowing what to ignore.',  author: '— James Clear'  },
    { text: 'Small steps every day\nadd up to big results.', author: '— Unknown'      },
    { text: 'The secret of getting\nahead is getting started.', author: '— Mark Twain' },
    { text: 'Deep work is the\nsuperpower of our time.',     author: '— Cal Newport'  },
    { text: 'Your future self is\nwatching right now.',      author: '— Unknown'      },
    { text: 'One task at a time.\nDone beats perfect.',      author: '— Unknown'      },
    { text: 'Energy flows where\nattention goes.',           author: '— Tony Robbins' },
  ];

  // Stable daily quote seed
  var seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  var q    = QUOTES[seed % QUOTES.length];

  var qEl = document.getElementById('sticky-quote');
  var aEl = document.getElementById('sticky-author');
  if (qEl) qEl.innerHTML  = q.text.replace(/\n/g, '<br>');
  if (aEl) aEl.textContent = q.author;

  // ── Focus session elapsed timer ───────────────────────────────────────────
  // Owned by popup.js (reads session.focusStartedAt from storage).
  // Do NOT start a local timer here — it would reset every popup open.

  // ── Break CTA description from storage ────────────────────────────────────
  try {
    var api = (typeof browser !== 'undefined') ? browser : chrome;
    if (api && api.storage) {
      api.storage.local.get('fg_settings', function (result) {
        var mins = (result && result.fg_settings && result.fg_settings.breakMaxMinutes) || 10;
        var el   = document.getElementById('break-cta-desc');
        if (el) el.textContent = 'Take a ' + mins + ' min break';
      });
    }
  } catch (e) { /* ignore */ }

  // ── Task count sync ────────────────────────────────────────────────────────
  // Watches the todo list for DOM changes and updates the task count badge.
  // Progress bar has been removed — only task count and goal text remain.
  function updateMission() {
    var goalEl  = document.getElementById('mission-goal');
    var listEl  = document.getElementById('todo-list');
    var countEl = document.getElementById('task-count');
    if (!listEl) return;

    var items     = listEl.querySelectorAll('.todo-item');
    var completed = listEl.querySelectorAll('.todo-item.completed');
    var total     = items.length;
    var done      = completed.length;

    // Update task count badge (e.g. "2 / 5")
    if (countEl) countEl.textContent = total > 0 ? done + ' / ' + total : '';

    // Pull goal text from first goal-badge item
    if (goalEl) {
      var goalBadge = listEl.querySelector('.todo-goal-badge');
      if (goalBadge) {
        var parentLi = goalBadge.closest('.todo-item');
        var textEl   = parentLi ? parentLi.querySelector('.todo-text') : null;
        if (textEl) goalEl.textContent = textEl.textContent;
      } else if (total === 0) {
        goalEl.textContent = 'Add your goal above';
      }
    }

    // Visual hint for task input placeholder
    var taskInput = document.getElementById('task-input');
    if (taskInput && listEl.querySelector('.todo-goal-badge')) {
      if (!taskInput.getAttribute('data-has-goal')) {
        taskInput.setAttribute('data-has-goal', 'true');
      }
    }
  }

  // Observe todo list for DOM changes
  var todoList = document.getElementById('todo-list');
  if (todoList && window.MutationObserver) {
    var obs = new MutationObserver(updateMission);
    obs.observe(todoList, { childList: true, subtree: true, attributes: true });
  }

  // Initial run after popup.js renders
  setTimeout(updateMission, 200);
  setTimeout(updateMission, 600);

})();
