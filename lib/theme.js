/**
 * Sage — Theme & Token Manager
 *
 * Centralized Theme Manager providing:
 *  - Design Token System (CSS variables)
 *  - Theme synchronization (auto, light, dark)
 *  - Host specific adapters (YouTube, Instagram)
 *  - Event-based subscriptions
 */

/* global chrome, browser */
/* jshint esversion: 5 */

const ThemeManager = (function () {
  'use strict';

  const STORAGE_KEY  = 'fg_theme_preference';
  const api = (typeof browser !== 'undefined') ? browser : chrome;

  // ── Design Tokens ────────────────────────────────────────────────────────
  const tokens = {
    colors: {
      light: {
        bgPrimary: 'rgba(248, 246, 242, 0.94)',
        surface: '#FFFDF8',
        surfaceElevated: '#FFFFFF',
        textPrimary: '#202020',
        textSecondary: '#666666',
        textMuted: '#A09890',
        border: 'rgba(0, 0, 0, 0.08)',
        accent: '#7A8F72',
        accentHover: '#6D8265',
        accentLight: 'rgba(122, 143, 114, 0.12)',
        danger: '#b83c2e',
        dangerBg: 'rgba(192, 57, 43, 0.08)',
        success: '#689e60',
        warning: '#d9a04a',
        btnGhostBg: 'rgba(0, 0, 0, 0.04)',
        btnGhostText: 'rgba(0, 0, 0, 0.65)'
      },
      dark: {
        bgPrimary: '#1A1B18',        // Forest Night Background
        surface: '#24241F',          // Forest Night Card
        surfaceElevated: '#2D2E28',  // Forest Night Elevated Card
        textPrimary: '#F2F1ED',
        textSecondary: '#C6C4BE',
        textMuted: '#A7A59E',
        border: 'rgba(255, 255, 255, 0.08)',
        accent: '#7A8F72',
        accentHover: '#8FA285',
        accentLight: 'rgba(143, 168, 133, 0.12)',
        danger: '#C46B63',
        dangerBg: 'rgba(192, 57, 43, 0.12)',
        success: '#88A87D',
        warning: '#C7A861',
        btnGhostBg: 'rgba(255, 255, 255, 0.06)',
        btnGhostText: 'rgba(255, 255, 255, 0.7)'
      }
    },
    spacing: {
      xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px'
    },
    radius: {
      sm: '6px', btn: '8px', card: '16px', pill: '20px'
    },
    shadows: {
      light: {
        card: '0 4px 24px rgba(0, 0, 0, 0.08)',
        overlay: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.8)'
      },
      dark: {
        card: '0 4px 24px rgba(52, 44, 37, 0.18)',
        overlay: '0 25px 60px rgba(52, 44, 37, 0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
      }
    },
    typography: {
      body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "'Playfair Display', Georgia, serif"
    },
    motion: {
      durationFast: '120ms',
      durationNormal: '180ms',
      curve: 'cubic-bezier(0.4, 0, 0.2, 1)'
    },
    misc: {
      borderWidth: '1px',
      opacityDisabled: '0.5'
    }
  };

  /**
   * Generates CSS variables block based on the current theme tokens.
   */
  function getCssVariableString(themeStr) {
    const isDark = themeStr === 'dark';
    const c = isDark ? tokens.colors.dark : tokens.colors.light;
    const s = isDark ? tokens.shadows.dark : tokens.shadows.light;
    
    return `
      --fg-bg-primary: ${c.bgPrimary};
      --fg-surface: ${c.surface};
      --fg-surface-elevated: ${c.surfaceElevated};
      --fg-text-primary: ${c.textPrimary};
      --fg-text-secondary: ${c.textSecondary};
      --fg-text-muted: ${c.textMuted};
      --fg-border: ${c.border};
      --fg-accent: ${c.accent};
      --fg-accent-hover: ${c.accentHover};
      --fg-accent-light: ${c.accentLight};
      --fg-danger: ${c.danger};
      --fg-danger-bg: ${c.dangerBg};
      --fg-success: ${c.success};
      --fg-warning: ${c.warning};
      --fg-btn-ghost-bg: ${c.btnGhostBg};
      --fg-btn-ghost-text: ${c.btnGhostText};
      
      --fg-spacing-xs: ${tokens.spacing.xs};
      --fg-spacing-sm: ${tokens.spacing.sm};
      --fg-spacing-md: ${tokens.spacing.md};
      --fg-spacing-lg: ${tokens.spacing.lg};
      --fg-spacing-xl: ${tokens.spacing.xl};
      
      --fg-radius-sm: ${tokens.radius.sm};
      --fg-radius-btn: ${tokens.radius.btn};
      --fg-radius-card: ${tokens.radius.card};
      --fg-radius-pill: ${tokens.radius.pill};
      
      --fg-shadow-card: ${s.card};
      --fg-shadow-overlay: ${s.overlay};
      
      --fg-font-body: ${tokens.typography.body};
      --fg-font-display: ${tokens.typography.display};
      
      --fg-duration-fast: ${tokens.motion.durationFast};
      --fg-duration-normal: ${tokens.motion.durationNormal};
      --fg-curve: ${tokens.motion.curve};
      
      --fg-border-width: ${tokens.misc.borderWidth};
      --fg-opacity-disabled: ${tokens.misc.opacityDisabled};
    `;
  }

  // ── Event Management ───────────────────────────────────────────────────────
  const listeners = new Set();
  
  function subscribe(listener) {
    listeners.add(listener);
  }
  
  function unsubscribe(listener) {
    listeners.delete(listener);
  }

  function notifySubscribers(theme) {
    listeners.forEach(cb => {
      try { cb(theme); } catch (e) { console.error('Theme listener error', e); }
    });
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let currentMode = 'auto'; // 'auto' | 'light' | 'dark'
  let activeTheme = 'light';
  let hostAdapterCleanup = null;

  function _resolveTheme() {
    if (currentMode !== 'auto') return currentMode;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function _updateTheme() {
    const resolved = _resolveTheme();
    if (resolved !== activeTheme) {
      activeTheme = resolved;
      notifySubscribers(activeTheme);
    }
  }

  // ── Adapters ───────────────────────────────────────────────────────────────
  const Adapters = {
    generic: {
      init() {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => _updateTheme();
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      }
    },
    youtube: {
      init() {
        const handler = () => _updateTheme();
        const obs = new MutationObserver(handler);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
        return () => obs.disconnect();
      },
      resolve() {
        return document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
      }
    },
    instagram: {
      init() {
        const handler = () => _updateTheme();
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', handler);
        const obs = new MutationObserver(handler);
        const metaEl = document.querySelector('meta[name="color-scheme"]');
        if (metaEl) obs.observe(metaEl, { attributes: true, attributeFilter: ['content'] });
        return () => {
          mq.removeEventListener('change', handler);
          obs.disconnect();
        };
      },
      resolve() {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta && meta.content.includes('dark')) return 'dark';
        if (document.documentElement.style.colorScheme === 'dark') return 'dark';
        let bgLuminance = 1;
        try {
          const bg = window.getComputedStyle(document.body).backgroundColor;
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            bgLuminance = (0.299 * parseInt(m[1], 10) + 0.587 * parseInt(m[2], 10) + 0.114 * parseInt(m[3], 10)) / 255;
          }
        } catch (e) {}
        if (bgLuminance < 0.5) return 'dark';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    }
  };

  /**
   * Initializes theme reactivity based on the context.
   * @param {string|null} context - 'youtube', 'instagram', or null for generic popup/settings.
   */
  function init(context) {
    if (hostAdapterCleanup) {
      hostAdapterCleanup();
      hostAdapterCleanup = null;
    }

    let adapter = Adapters.generic;
    if (context === 'youtube') adapter = Adapters.youtube;
    else if (context === 'instagram') adapter = Adapters.instagram;

    // Load user preference if any (cache)
    try {
      if (api && api.storage) {
        api.storage.local.get(STORAGE_KEY, (res) => {
          if (res[STORAGE_KEY]) currentMode = res[STORAGE_KEY];
          
          if (currentMode === 'auto' && adapter.resolve) {
            activeTheme = adapter.resolve();
          } else {
            activeTheme = _resolveTheme();
          }
          notifySubscribers(activeTheme);
        });
      }
    } catch (e) {}

    // Synchronous initial resolve
    if (adapter.resolve && currentMode === 'auto') {
      activeTheme = adapter.resolve();
    } else {
      activeTheme = _resolveTheme();
    }
    
    // Listen to changes
    hostAdapterCleanup = adapter.init();

    // Listen to cross-window storage changes
    try {
      if (api && api.storage) {
        api.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[STORAGE_KEY]) {
            currentMode = changes[STORAGE_KEY].newValue || 'auto';
            _updateTheme();
          }
        });
      }
    } catch(e) {}
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function getTheme() {
    return activeTheme;
  }

  function getMode() {
    return currentMode;
  }

  function setTheme(mode) {
    currentMode = mode;
    try {
      if (api && api.storage) {
        let obj = {};
        obj[STORAGE_KEY] = mode;
        api.storage.local.set(obj);
      }
    } catch (e) {}
    _updateTheme();
  }

  function applyTheme(targetElement) {
    if (activeTheme === 'dark') {
      targetElement.setAttribute('data-theme', 'dark');
    } else {
      targetElement.removeAttribute('data-theme');
    }

    // Also inject variables globally if targetElement is document.documentElement
    // (Used by popup and settings to avoid duplicate variable definitions)
    if (targetElement === document.documentElement) {
      let styleEl = document.getElementById('fg-theme-vars');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'fg-theme-vars';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        :root {
          ${getCssVariableString(activeTheme)}
        }
      `;
    }
  }

  // Initialize immediately for popup/settings (generic)
  // Content scripts will re-initialize with specific context if needed.
  init(null);

  // Bind an automatic listener to document.documentElement
  subscribe((theme) => {
    // We safely apply it to the root document if we are in popup/settings
    // In content scripts, document.documentElement shouldn't be manipulated, 
    // but popup/settings need it. Content scripts will use their own shadow roots.
    // For safety, let's only do this if it's the extension page:
    if (typeof location !== 'undefined' && (location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:')) {
      applyTheme(document.documentElement);
    }
  });

  return {
    init,
    getTheme,
    getMode,
    setTheme,
    applyTheme,
    subscribe,
    unsubscribe,
    getCssVariableString,
    tokens
  };

})();

// To ensure legacy compatibility across files
if (typeof window !== 'undefined') window.FocusGuardTheme = ThemeManager;
if (typeof window !== 'undefined') window.ThemeManager = ThemeManager;
