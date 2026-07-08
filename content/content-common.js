/* FocusGuard — Content Script Common Utilities (Plain Script) */

(function() {
  'use strict';

  const api = (typeof browser !== 'undefined') ? browser : chrome;

  // Message type constants (mirrored from lib/constants.js)
  const FG_MSG = {
    CHECK_DISTRACTION: 'CHECK_DISTRACTION',
    URL_CHANGED: 'URL_CHANGED',
    UNBLOCK_PAGE: 'UNBLOCK_PAGE',
    BREAK_ENDED: 'BREAK_ENDED',
    ENABLE_CHILL: 'ENABLE_CHILL',
  };

  // ---- SEND TO BACKGROUND ----
  function fgSendMessage(msg) {
    return api.runtime.sendMessage(msg);
  }

  // ---- URL CHANGE DETECTION ----
  // Uses MutationObserver + popstate as fallback to webNavigation messages from background
  let _lastUrl = location.href;
  let _urlChangeCallbacks = [];

  function fgOnUrlChange(callback) {
    _urlChangeCallbacks.push(callback);
  }

  function _notifyUrlChange(url) {
    if (url === _lastUrl) return;
    _lastUrl = url;
    _urlChangeCallbacks.forEach(cb => cb(url));
  }

  // MutationObserver fallback (debounced)
  let _debounceTimer;
  const urlObserver = new MutationObserver(() => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (location.href !== _lastUrl) {
        _notifyUrlChange(location.href);
      }
    }, 150);
  });
  
  const titleNode = document.querySelector('title');
  if (titleNode) {
    urlObserver.observe(titleNode, { childList: true, subtree: true, characterData: true });
  }

  // popstate for back/forward
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      if (location.href !== _lastUrl) _notifyUrlChange(location.href);
    }, 50);
  });

  // Listen for URL_CHANGED from background (webNavigation API)
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === FG_MSG.URL_CHANGED) {
      _notifyUrlChange(message.url);
    }
    if (message.type === FG_MSG.UNBLOCK_PAGE) {
      fgRemoveOverlay();
    }
    if (message.type === FG_MSG.BREAK_ENDED) {
      // Re-check current page
      _urlChangeCallbacks.forEach(cb => cb(location.href));
    }
  });

  // ============================================================
  //  THEME DETECTION (shared by all content scripts)
  //
  //  Returns true if the host site is using a dark color scheme.
  //
  //  Detection priority (highest to lowest reliability):
  //    1. Site-specific DOM signals (most reliable — never wrong)
  //    2. meta[name="color-scheme"] (Instagram / general sites)
  //    3. document.documentElement.style.colorScheme
  //    4. window.matchMedia('prefers-color-scheme: dark')
  //    5. Computed background luminance (last resort)
  //
  //  The 'site' param ('youtube' | 'instagram' | null) enables
  //  site-specific checks first before falling through to generics.
  // ============================================================

  // ============================================================
  //  UI BUILDERS (Shared for all content scripts)
  //  These consume CSS variables defined by ThemeManager
  // ============================================================

  const FGUI = {
    _recentQuotes: [],
    _quotes: [
      "Discipline today, freedom tomorrow.",
      "Your focus is your future.",
      "Is this getting you closer to your goal?",
      "Take a breath. Return to center.",
      "Don't trade what you want most for what you want now.",
      "The task at hand is all that matters.",
      "Control your attention, control your life.",
      "Focus is a muscle. Flex it."
    ],

    createQuote: function() {
      const available = this._quotes.filter(q => !this._recentQuotes.includes(q));
      const pool = available.length > 0 ? available : this._quotes;
      const quote = pool[Math.floor(Math.random() * pool.length)];
      
      this._recentQuotes.push(quote);
      if (this._recentQuotes.length > 3) this._recentQuotes.shift();
      
      return quote;
    },

    createLogo: function() {
      const container = document.createElement('div');
      container.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        margin-bottom: var(--fg-spacing-lg);
      `;
      
      const brand = document.createElement('div');
      brand.textContent = 'SAGE';
      brand.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.15em;
        color: var(--fg-text-muted);
      `;

      const leaf = document.createElement('div');
      leaf.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--fg-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
      `;
      
      container.appendChild(brand);
      container.appendChild(leaf);
      return container;
    },

    createHeading: function(text) {
      const h2 = document.createElement('h2');
      h2.textContent = text;
      h2.style.cssText = `
        font-family: var(--fg-font-display);
        font-size: 26px;
        font-weight: 700;
        color: var(--fg-text-primary);
        margin-bottom: var(--fg-spacing-sm);
        line-height: 1.2;
      `;
      return h2;
    },

    createButton: function(text, variant) {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.className = 'fg-btn fg-btn-' + variant;
      
      let bg, color, border;
      if (variant === 'primary') {
        bg = 'var(--fg-text-primary)';
        color = 'var(--fg-bg-primary)';
        border = 'none';
      } else if (variant === 'chill') {
        bg = 'rgba(16, 185, 129, 0.15)';
        color = '#059669';
        border = '1px solid rgba(16, 185, 129, 0.3)';
        // Note: In CSS we should adapt this for dark mode. We can use variables for chill too.
      } else {
        bg = 'var(--fg-btn-ghost-bg)';
        color = 'var(--fg-btn-ghost-text)';
        border = '1px solid var(--fg-border)';
      }

      btn.style.cssText = `
        padding: 12px 24px;
        border-radius: var(--fg-radius-btn);
        font-family: var(--fg-font-body);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        background: ${bg};
        color: ${color};
        border: ${border};
        transition: all var(--fg-duration-fast) var(--fg-curve);
      `;
      
      btn.onmouseover = () => btn.style.transform = 'translateY(-1px)';
      btn.onmouseout = () => btn.style.transform = 'none';
      btn.onmousedown = () => btn.style.transform = 'scale(0.97)';
      btn.onmouseup = () => btn.style.transform = 'translateY(-1px)';

      return btn;
    },

    createCard: function() {
      const card = document.createElement('div');
      card.style.cssText = `
        background: var(--fg-surface);
        border: var(--fg-border-width) solid var(--fg-border);
        border-radius: var(--fg-radius-card);
        padding: var(--fg-spacing-xl) var(--fg-spacing-xl);
        max-width: 440px;
        width: 90%;
        text-align: center;
        box-shadow: var(--fg-shadow-card);
        animation: fgScaleIn var(--fg-duration-normal) var(--fg-curve);
        position: relative;
        overflow: hidden;
      `;
      return card;
    }
  };

  // ---- OVERLAY INJECTION (Shadow DOM) ----
  const OVERLAY_ID = 'focusguard-overlay-root';

  function fgInjectOverlay(config) {
    fgRemoveOverlay(); 

    // Initialize the ThemeManager context (e.g. 'youtube' or 'instagram' or null)
    ThemeManager.init(config.site || null);
    
    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
    `;
    ThemeManager.applyTheme(host); // set data-theme

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');
      
      :host {
        ${ThemeManager.getCssVariableString('light')}
      }
      :host([data-theme="dark"]) {
        ${ThemeManager.getCssVariableString('dark')}
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      @keyframes fgFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fgScaleIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: none; } }
      
      .fg-btn-chill {
        background: rgba(16, 185, 129, 0.15) !important;
        color: #059669 !important;
        border: 1px solid rgba(16, 185, 129, 0.3) !important;
      }
      :host([data-theme="dark"]) .fg-btn-chill {
        color: #6ee7b7 !important;
      }

      @media (prefers-reduced-motion: reduce) {
        *, ::before, ::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      background: var(--fg-bg-primary);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--fg-font-body);
      animation: fgFadeIn var(--fg-duration-normal) var(--fg-curve);
    `;

    const card = FGUI.createCard();
    
    // Logo
    card.appendChild(FGUI.createLogo());

    // Title
    card.appendChild(FGUI.createHeading(
      config.showChillPrompt ? 'Do you want to chill today?' : 'Stay Focused'
    ));

    // Message
    const msg = document.createElement('p');
    msg.textContent = config.message;
    msg.style.cssText = `
      font-size: 15px;
      color: var(--fg-text-secondary);
      line-height: 1.6;
      margin-bottom: var(--fg-spacing-lg);
    `;
    card.appendChild(msg);

    // Quote Box (only if not chilling)
    if (!config.showChillPrompt) {
      const quoteBox = document.createElement('div');
      quoteBox.style.cssText = `
        background: var(--fg-accent-light);
        border-radius: var(--fg-radius-sm);
        padding: var(--fg-spacing-md);
        margin-bottom: var(--fg-spacing-lg);
        color: var(--fg-text-muted);
        font-style: italic;
        font-size: 13px;
      `;
      quoteBox.textContent = `"${FGUI.createQuote()}"`;
      card.appendChild(quoteBox);
    }

    // Actions
    const actions = document.createElement('div');
    actions.style.cssText = `
      display: flex;
      gap: var(--fg-spacing-md);
      justify-content: center;
      flex-wrap: wrap;
    `;

    if (config.showChillPrompt) {
      const chillBtn = FGUI.createButton('I want to chill', 'chill');
      chillBtn.addEventListener('click', () => {
        fgSendMessage({ type: FG_MSG.ENABLE_CHILL });
        fgRemoveOverlay();
      });
      actions.appendChild(chillBtn);

      const blockBtn = FGUI.createButton('No, block me', 'primary');
      blockBtn.addEventListener('click', () => {
        fgRemoveOverlay();
        fgInjectOverlay({
          message: "Good choice! Stay focused. You've got this.",
          showChillPrompt: false,
          showGoBack: true,
          site: config.site,
        });
      });
      actions.appendChild(blockBtn);
    } else {
      const goBackBtn = FGUI.createButton('← Back to Focus', 'primary');
      goBackBtn.addEventListener('click', () => {
        history.back();
        setTimeout(() => fgRemoveOverlay(), 300);
      });
      actions.appendChild(goBackBtn);
    }

    card.appendChild(actions);
    backdrop.appendChild(card);
    shadow.appendChild(backdrop);
    document.documentElement.appendChild(host);

    // Reactive theme tracking: subscribe to ThemeManager and update data-theme
    const onThemeChange = (theme) => {
      const existing = document.getElementById(OVERLAY_ID);
      if (existing) {
        ThemeManager.applyTheme(existing);
      }
    };
    ThemeManager.subscribe(onThemeChange);
    host._fgThemeUnsubscribe = () => ThemeManager.unsubscribe(onThemeChange);
  }

  function fgRemoveOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      if (existing._fgThemeUnsubscribe) {
        existing._fgThemeUnsubscribe();
      }
      existing.remove();
    }
  }

  // ---- DISTRACTION CHECK ----
  async function fgCheckAndBlock(site, pageType, previousPageType = null) {
    try {
      const result = await fgSendMessage({
        type: FG_MSG.CHECK_DISTRACTION,
        site,
        pageType,
        previousPageType,
        referrer: document.referrer || '',
      });

      if (result.shouldBlock) {
        fgInjectOverlay({
          message: result.message,
          showChillPrompt: !!result.showChillPrompt,
          showGoBack: !result.showChillPrompt,
          site,
        });
      } else {
        fgRemoveOverlay();
      }
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FocusGuard] Error checking distraction:', err);
      }
    }
  }

  // Export to global scope for site-specific scripts
  window.__FG = {
    MSG: FG_MSG,
    sendMessage: fgSendMessage,
    onUrlChange: fgOnUrlChange,
    injectOverlay: fgInjectOverlay,
    removeOverlay: fgRemoveOverlay,
    checkAndBlock: fgCheckAndBlock,
    UI: FGUI
  };
})();
