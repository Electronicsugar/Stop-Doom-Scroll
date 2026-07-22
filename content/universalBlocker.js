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
      const result = await api.storage.local.get('fg_blocked_urls');
      if (result.fg_blocked_urls) {
        cachedRules = result.fg_blocked_urls;
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
    
    const hydratedRules = cachedRules.map(r => {
      if (r.type === 'wildcard' && !r.regex) return matcher.compileRule(r);
      return r;
    });

    const matchedRule = matcher.isBlocked(url, hydratedRules);
    if (matchedRule) {
      // In fast path, we must be careful: if temp allowed, fast path will falsely block.
      // We rely on initSlowPath to immediately undo it if temp allowed.
      enforceBlock(matchedRule);
    } else {
      removeBlock();
    }
  }

  // ── 3. Overlay Management ───────────────────────────────────────────────────

  function enforceBlock(matchedRule) {
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
      :host {
        --bg-color: #1a1b18;
        --text-main: #e6eed8;
        --text-muted: #88947c;
        --accent: #a3b899;
        --btn-bg: #2a2c26;
        --btn-hover: #34372e;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background-color: var(--bg-color);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text-main);
        backdrop-filter: blur(10px);
      }
      .container {
        text-align: center;
        max-width: 400px;
        padding: 40px;
        background: rgba(42, 44, 38, 0.4);
        border: 1px solid rgba(163, 184, 153, 0.1);
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      }
      h1 {
        font-family: 'Playfair Display', serif;
        font-size: 32px;
        margin: 0 0 10px 0;
        color: var(--accent);
      }
      p {
        margin: 0 0 30px 0;
        font-size: 15px;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .rule-badge {
        display: inline-block;
        padding: 4px 12px;
        background: rgba(163, 184, 153, 0.1);
        border-radius: 20px;
        font-size: 13px;
        color: var(--accent);
        margin-bottom: 20px;
        font-family: monospace;
      }
      .btn-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      button {
        background: var(--btn-bg);
        color: var(--text-main);
        border: 1px solid rgba(255,255,255,0.05);
        padding: 14px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      button:hover {
        background: var(--btn-hover);
      }
      button.primary {
        background: var(--accent);
        color: var(--bg-color);
      }
      button.primary:hover {
        background: #b5ccaa;
      }
    `;

    const container = document.createElement('div');
    container.className = 'container';
    
    container.innerHTML = `
      <h1>🌿 Sage</h1>
      <p>Stay Focused. This website has been blocked.</p>
      <div class="rule-badge">Matched: ${rule ? rule.normalizedPattern : window.location.hostname}</div>
      <div class="btn-group">
        <button id="btn-back" class="primary">Go Back</button>
        <button id="btn-allow-5" data-mins="5">Temporarily Allow (5 min)</button>
        <button id="btn-allow-10" data-mins="10">Temporarily Allow (10 min)</button>
        <button id="btn-whitelist">Whitelist Website</button>
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
        else if (btn.id === 'btn-whitelist') {
          if (rule && rule.id) {
            const res = await safeSendMessage({ type: 'WHITELIST_RULE', ruleId: rule.id });
            if (res && res.success) removeBlock();
          }
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
    if (area === 'local' && changes.fg_blocked_urls) {
      cachedRules = changes.fg_blocked_urls.newValue || [];
      checkUrl(window.location.href, 'sync');
    }
  });

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'BLOCKED_URLS_UPDATED' || msg.type === 'TEMP_ALLOW_STATE_CHANGED') {
      initSlowPath(); 
    }
    if (msg.type === 'URL_CHANGED') {
      // For URL changes, checking the fast path is fine, but if it blocks,
      // initSlowPath will correct it if there's an active temp allow.
      checkUrl(msg.url || window.location.href, 'msg');
      initSlowPath();
    }
  });

})();
