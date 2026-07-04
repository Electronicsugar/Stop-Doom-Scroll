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
  new MutationObserver(() => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (location.href !== _lastUrl) {
        _notifyUrlChange(location.href);
      }
    }, 150);
  }).observe(document.documentElement, { subtree: true, childList: true });

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

  // ---- OVERLAY INJECTION (Shadow DOM) ----
  const OVERLAY_ID = 'focusguard-overlay-root';

  function fgInjectOverlay(config) {
    // config: { message, showChillPrompt, showGoBack }
    fgRemoveOverlay(); // Remove existing overlay first

    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;pointer-events:auto!important;';

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      * { margin: 0; padding: 0; box-sizing: border-box; }

      .fg-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(5, 5, 20, 0.92);
        backdrop-filter: blur(20px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        animation: fgFadeIn 0.4s ease;
      }

      .fg-card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 40px 48px;
        max-width: 480px;
        width: 90%;
        text-align: center;
        backdrop-filter: blur(30px);
        box-shadow: 0 25px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
        animation: fgScaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .fg-shield {
        font-size: 48px;
        margin-bottom: 16px;
        display: block;
        filter: drop-shadow(0 4px 12px rgba(124, 58, 237, 0.3));
      }

      .fg-title {
        font-size: 22px;
        font-weight: 700;
        color: #e2e8f0;
        margin-bottom: 12px;
        line-height: 1.3;
      }

      .fg-message {
        font-size: 15px;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.6;
        margin-bottom: 28px;
      }

      .fg-goal-text {
        display: inline-block;
        background: linear-gradient(135deg, rgba(124,58,237,0.2), rgba(59,130,246,0.2));
        border: 1px solid rgba(124,58,237,0.3);
        border-radius: 8px;
        padding: 8px 16px;
        margin-top: 8px;
        color: #c4b5fd;
        font-weight: 500;
        font-size: 14px;
      }

      .fg-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
      }

      .fg-btn {
        padding: 12px 28px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .fg-btn:hover { transform: translateY(-1px); }
      .fg-btn:active { transform: translateY(0); }

      .fg-btn-primary {
        background: linear-gradient(135deg, #7c3aed, #3b82f6);
        color: white;
        box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);
      }
      .fg-btn-primary:hover { box-shadow: 0 6px 20px rgba(124, 58, 237, 0.4); }

      .fg-btn-ghost {
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.7);
        border: 1px solid rgba(255,255,255,0.1);
      }
      .fg-btn-ghost:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }

      .fg-btn-chill {
        background: rgba(16, 185, 129, 0.15);
        color: #6ee7b7;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      .fg-btn-chill:hover { background: rgba(16, 185, 129, 0.25); }

      @keyframes fgFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes fgScaleIn {
        from { opacity: 0; transform: scale(0.9) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
    `;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'fg-backdrop';

    const card = document.createElement('div');
    card.className = 'fg-card';

    // Shield icon
    const shield = document.createElement('span');
    shield.className = 'fg-shield';
    shield.textContent = '🛡️';
    card.appendChild(shield);

    // Title
    const title = document.createElement('h2');
    title.className = 'fg-title';
    title.textContent = config.showChillPrompt ? 'Do you want to chill today?' : 'Stay Focused';
    card.appendChild(title);

    // Message
    const msg = document.createElement('p');
    msg.className = 'fg-message';
    msg.textContent = config.message;
    card.appendChild(msg);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'fg-actions';

    if (config.showChillPrompt) {
      const chillBtn = document.createElement('button');
      chillBtn.className = 'fg-btn fg-btn-chill';
      chillBtn.textContent = 'I want to chill';
      chillBtn.addEventListener('click', () => {
        fgSendMessage({ type: FG_MSG.ENABLE_CHILL });
        fgRemoveOverlay();
      });
      actions.appendChild(chillBtn);

      const blockBtn = document.createElement('button');
      blockBtn.className = 'fg-btn fg-btn-primary';
      blockBtn.textContent = 'No, block me';
      blockBtn.addEventListener('click', () => {
        // Stay blocked - just dismiss the chill prompt aspect
        // Re-render with a standard block message
        fgRemoveOverlay();
        fgInjectOverlay({
          message: "Good choice! Stay focused. You've got this.",
          showChillPrompt: false,
          showGoBack: true,
        });
      });
      actions.appendChild(blockBtn);
    } else {
      const goBackBtn = document.createElement('button');
      goBackBtn.className = 'fg-btn fg-btn-primary';
      goBackBtn.textContent = 'Go Back';
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
  }

  function fgRemoveOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  function fgIsOverlayActive() {
    return !!document.getElementById(OVERLAY_ID);
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
    isOverlayActive: fgIsOverlayActive,
    checkAndBlock: fgCheckAndBlock,
  };

  console.log('[FocusGuard] Content common loaded');
})();
