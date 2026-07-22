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

  // ── 1. Initialize Hybrid Fast/Slow Path ─────────────────────────────────────

  // Fast path: Load rules from storage and matcher via dynamic import
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

  // Slow path: Ask background directly
  function initSlowPath() {
    api.runtime.sendMessage({ type: 'GET_BLOCK_STATUS', url: window.location.href }, (response) => {
      if (api.runtime.lastError) return;
      if (response && response.blocked) {
        enforceBlock(response.matchedRule);
      } else if (response && !response.blocked) {
        removeBlock();
      }
    });
  }

  initFastPath();
  initSlowPath();

  // ── 2. Evaluation Logic ─────────────────────────────────────────────────────

  function checkUrl(url, source) {
    if (!matcher || !cachedRules) return;
    
    // We must re-hydrate the regex for wildcard rules when reading from storage locally
    // because storage drops RegExp objects.
    const hydratedRules = cachedRules.map(r => {
      if (r.type === 'wildcard' && !r.regex) {
        return matcher.compileRule(r);
      }
      return r;
    });

    const matchedRule = matcher.isBlocked(url, hydratedRules);
    if (matchedRule) {
      enforceBlock(matchedRule);
    } else {
      removeBlock();
    }
  }

  // ── 3. Overlay Management ───────────────────────────────────────────────────

  function enforceBlock(matchedRule) {
    if (isCurrentlyBlocked) return;
    isCurrentlyBlocked = true;

    // Suppress body scrolling/interaction without deleting it (preserves SPA state)
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
      
      // Inject as early as possible
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
        <button id="btn-allow-5">Temporarily Allow (5 min)</button>
        <button id="btn-allow-15">Temporarily Allow (15 min)</button>
      </div>
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(container);

    shadowRoot.getElementById('btn-back').addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'chrome://newtab/'; // Fallback
      }
    });

    const allowTemp = (minutes) => {
      api.runtime.sendMessage({ 
        type: 'TEMP_ALLOW_URL', 
        url: window.location.href, 
        durationMs: minutes * 60000 
      }, (res) => {
        if (res && res.success) removeBlock();
      });
    };

    shadowRoot.getElementById('btn-allow-5').addEventListener('click', () => allowTemp(5));
    shadowRoot.getElementById('btn-allow-15').addEventListener('click', () => allowTemp(15));
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
    if (msg.type === 'BLOCKED_URLS_UPDATED') {
      initSlowPath(); // Re-verify against background state (e.g. temp allow expired)
    }
    if (msg.type === 'URL_CHANGED') {
      checkUrl(msg.url || window.location.href, 'msg');
    }
  });

  // Monitor SPA internal navigations
  let lastUrl = window.location.href;
  const observeUrlChange = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      checkUrl(lastUrl, 'spa');
    }
  };

  window.addEventListener('popstate', observeUrlChange);
  
  // Intercept pushState and replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    observeUrlChange();
  };
  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    observeUrlChange();
  };

})();
