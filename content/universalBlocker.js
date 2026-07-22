/**
 * FocusGuard — Universal Website Blocker Content Script
 * 
 * Injected at document_start. Implements a fast/slow path hybrid architecture.
 * Uses Shadow DOM to isolate the blocking UI and prevent host page interference.
 */

(async () => {
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  let matcher = null;
  let cachedRules = [];
  let cachedSession = null;
  let isCurrentlyBlocked = false;
  let overlayContainer = null;
  let shadowRoot = null;

  // Safe sendMessage wrapper for cross-browser MV3 compatibility
  async function safeSendMessage(payload) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(payload, (res) => {
            if (chrome.runtime.lastError) console.error('[FocusGuard] sendMessage error:', chrome.runtime.lastError);
            resolve(res || null);
          });
        } else {
          api.runtime.sendMessage(payload).then(resolve).catch(err => {
            console.error('[FocusGuard] sendMessage error:', err);
            resolve(null);
          });
        }
      } catch (err) {
        console.error('[FocusGuard] safeSendMessage exception:', err);
        resolve(null);
      }
    });
  }

  // ── 1. Initialize Hybrid Fast/Slow Path ─────────────────────────────────────

  async function initFastPath() {
    try {
      const src = api.runtime.getURL('lib/urlMatcher.js');
      matcher = await import(src);
      const result = await api.storage.local.get(['fg_blocked_urls', 'fg_session']);
      if (result.fg_blocked_urls) {
        cachedRules = result.fg_blocked_urls;
      }
      if (result.fg_session) {
        cachedSession = result.fg_session;
      }
      checkUrl(window.location.href, 'fast');
    } catch (e) {
      console.warn('[FocusGuard] Fast path failed, relying on background', e);
    }
  }

  async function initSlowPath() {
    const response = await safeSendMessage({ type: 'GET_BLOCK_STATUS', url: window.location.href });
    if (response && response.blocked) {
      enforceBlock(response.matchedRule);
    } else if (response && !response.blocked) {
      removeBlock();
    }
  }

  initFastPath();
  initSlowPath();

  // ── 2. Evaluation Logic ─────────────────────────────────────────────────────

  function checkUrl(url, source) {
    if (!matcher || !cachedRules) return;

    // Fast check: if a break session is active, do not block
    if (cachedSession && cachedSession.breakModeActive) {
      if (!cachedSession.breakExpiresAt || Date.now() < cachedSession.breakExpiresAt) {
        removeBlock();
        return;
      }
    }
    
    const hydratedRules = cachedRules.map(r => {
      if (r.type === 'wildcard' && !r.regex) return matcher.compileRule(r);
      return r;
    });

    const matchedRule = matcher.isBlocked(url, hydratedRules);
    if (matchedRule) {
      enforceBlock(matchedRule);
    } else {
      removeBlock();
    }
  }

  // ── Theme Resolution Helper ──────────────────────────────────────────────────

  async function getActiveTheme() {
    try {
      const result = await api.storage.local.get('fg_theme_preference');
      const pref = result ? result.fg_theme_preference : 'auto';
      if (pref === 'dark') return 'dark';
      if (pref === 'light') return 'light';
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (e) {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
  }

  async function updateOverlayTheme() {
    if (!overlayContainer) return;
    const theme = await getActiveTheme();
    overlayContainer.setAttribute('data-theme', theme);
  }

  // ── 3. Overlay Management ───────────────────────────────────────────────────

  async function enforceBlock(matchedRule) {
    if (isCurrentlyBlocked) return;
    isCurrentlyBlocked = true;

    if (document.documentElement) {
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    }

    if (!overlayContainer) {
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'fg-universal-blocker';
      overlayContainer.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: transparent !important;
      `;
      shadowRoot = overlayContainer.attachShadow({ mode: 'closed' });
      renderBlockScreen(matchedRule);
      
      if (document.body) {
        document.body.appendChild(overlayContainer);
      } else {
        document.documentElement.appendChild(overlayContainer);
      }
    } else {
      overlayContainer.style.display = 'block';
    }
    
    await updateOverlayTheme();
    trapFocus();
  }

  function removeBlock() {
    if (!isCurrentlyBlocked) return;
    isCurrentlyBlocked = false;

    if (document.documentElement) {
      document.documentElement.style.removeProperty('overflow');
    }

    if (overlayContainer) {
      overlayContainer.style.display = 'none';
      overlayContainer.remove();
      overlayContainer = null;
      shadowRoot = null;
    }
  }

  function renderBlockScreen(rule) {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');

      :host {
        /* Default dark theme tokens with rich translucent glass backdrop & card */
        --bg-backdrop: rgba(18, 19, 16, 0.70);
        --card-bg: rgba(30, 32, 27, 0.75);
        --card-border: rgba(255, 255, 255, 0.14);
        --card-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);
        
        --brand-color: #8A9285;
        --leaf-color: #A3B899;
        --title-color: #F4F2ED;
        --desc-color: #D2D6CC;
        
        --badge-bg: rgba(122, 143, 114, 0.18);
        --badge-border: rgba(122, 143, 114, 0.35);
        --badge-color: #B5CCAA;

        --btn-primary-bg: #F4F2ED;
        --btn-primary-text: #141512;
        --btn-primary-hover: #FFFFFF;

        --btn-sec-bg: rgba(255, 255, 255, 0.08);
        --btn-sec-border: rgba(255, 255, 255, 0.14);
        --btn-sec-text: #D2D6CC;
        --btn-sec-hover: rgba(255, 255, 255, 0.16);

        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background-color: var(--bg-backdrop);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }

      :host([data-theme="light"]) {
        --bg-backdrop: rgba(244, 241, 235, 0.70);
        --card-bg: rgba(255, 253, 248, 0.80);
        --card-border: rgba(0, 0, 0, 0.09);
        --card-shadow: 0 24px 60px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8);

        --brand-color: #6E7669;
        --leaf-color: #56684F;
        --title-color: #1E201B;
        --desc-color: #2D2D2D;

        --badge-bg: rgba(122, 143, 114, 0.14);
        --badge-border: rgba(122, 143, 114, 0.28);
        --badge-color: #4E6347;

        --btn-primary-bg: #1E201B;
        --btn-primary-text: #F4F2ED;
        --btn-primary-hover: #000000;

        --btn-sec-bg: rgba(0, 0, 0, 0.05);
        --btn-sec-border: rgba(0, 0, 0, 0.12);
        --btn-sec-text: #2D2D2D;
        --btn-sec-hover: rgba(0, 0, 0, 0.09);
      }

      .container {
        text-align: center;
        max-width: 380px;
        width: calc(100% - 32px);
        padding: 30px 26px;
        background: var(--card-bg);
        border: 1px solid var(--card-border);
        border-radius: 16px;
        box-shadow: var(--card-shadow);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        animation: fgScaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes fgScaleIn {
        from { opacity: 0; transform: scale(0.96) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      .brand {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        color: var(--brand-color);
        margin-bottom: 10px;
        text-transform: uppercase;
      }

      .leaf-icon {
        color: var(--leaf-color);
        display: flex;
        justify-content: center;
        align-items: center;
        margin-bottom: 20px;
      }

      .leaf-icon svg {
        width: 34px;
        height: 34px;
      }

      h1 {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 26px;
        font-weight: 700;
        margin: 0 0 6px 0;
        color: var(--title-color);
        line-height: 1.2;
      }

      p {
        margin: 0 0 18px 0;
        font-size: 14px;
        font-weight: 450;
        color: var(--desc-color);
        line-height: 1.45;
      }

      .rule-badge {
        display: inline-block;
        padding: 5px 14px;
        background: var(--badge-bg);
        border: 1px solid var(--badge-border);
        border-radius: 9999px;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--badge-color);
        margin-bottom: 22px;
        font-family: monospace, sans-serif;
        word-break: break-all;
      }

      .btn-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 100%;
      }

      button {
        background: var(--btn-sec-bg);
        color: var(--btn-sec-text);
        border: 1px solid var(--btn-sec-border);
        padding: 9.5px 20px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.18s ease;
        width: auto;
        min-width: 190px;
        max-width: 240px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }

      button:hover {
        background: var(--btn-sec-hover);
        transform: translateY(-1px);
      }

      button:active {
        transform: scale(0.98);
      }

      button.primary {
        background: var(--btn-primary-bg);
        color: var(--btn-primary-text);
        border-color: transparent;
        font-weight: 600;
        font-size: 13.5px;
        padding: 9.5px 20px;
      }

      button.primary:hover {
        background: var(--btn-primary-hover);
      }
    `;

    const container = document.createElement('div');
    container.className = 'container';
    
    container.innerHTML = `
      <div class="brand">SAGE</div>
      <div class="leaf-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
      </div>
      <h1>Stay Focused</h1>
      <p>Stay Focused. This website has been blocked.</p>
      <div class="rule-badge">Matched: ${rule ? rule.normalizedPattern : window.location.hostname}</div>
      <div class="btn-group">
        <button id="btn-back" class="primary">← Go Back</button>
      </div>
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(container);

    // Event Delegation for robustness
    const btnGroup = shadowRoot.querySelector('.btn-group');
    if (btnGroup) {
      btnGroup.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.id === 'btn-back') {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = (typeof browser !== 'undefined') ? 'about:newtab' : 'chrome://newtab/';
          }
        } 
        else if (btn.id.startsWith('btn-allow-')) {
          const mins = parseInt(btn.dataset.mins, 10);
          const res = await safeSendMessage({ 
            type: 'TEMP_ALLOW_URL', 
            url: window.location.href, 
            durationMs: mins * 60000 
          });
          if (res && res.success) removeBlock();
        }
      });
    }
  }

  function trapFocus() {
    if (!shadowRoot) return;
    const focusable = shadowRoot.querySelectorAll('button');
    if (focusable.length > 0) focusable[0].focus();
  }

  // ── 4. Sync & SPA Detection ─────────────────────────────────────────────────

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.fg_blocked_urls) {
        cachedRules = changes.fg_blocked_urls.newValue || [];
        checkUrl(window.location.href, 'sync');
      }
      if (changes.fg_session) {
        cachedSession = changes.fg_session.newValue || null;
        checkUrl(window.location.href, 'session_change');
      }
      if (changes.fg_theme_preference) {
        updateOverlayTheme();
      }
    }
  });

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'UNBLOCK_PAGE') {
      removeBlock();
    }
    if (msg.type === 'BREAK_ENDED') {
      initSlowPath();
    }
    if (msg.type === 'BLOCKED_URLS_UPDATED' || msg.type === 'TEMP_ALLOW_STATE_CHANGED') {
      initSlowPath(); 
    }
    if (msg.type === 'URL_CHANGED') {
      // For URL changes, checking the fast path is fine, but if it blocks,
      // initSlowPath will correct it if there's an active temp allow or break mode.
      checkUrl(msg.url || window.location.href, 'msg');
      initSlowPath();
    }
  });

})();

