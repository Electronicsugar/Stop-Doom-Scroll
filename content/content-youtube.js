/* FocusGuard — YouTube Content Script (Plain Script / IIFE)
 *
 * Intentional Usage Model:
 *   HOME_FEED   → Hide recommendation grids, inject inline focus card
 *   DIRECT_VIDEO → Hide sidebar/autoplay/endscreen recommendations
 *   SHORTS      → Full block via existing FG.checkAndBlock() (unchanged)
 *   All others  → No suppression; full access
 *
 * Both HOME_FEED and DIRECT_VIDEO suppression are gated by settings.youtube.blockFeed.
 * Shorts is independently gated by settings.youtube.blockShorts.
 */

(function () {
  'use strict';

  const FG = window.__FG;
  if (!FG) { console.error('[FocusGuard] Common script not loaded'); return; }

  const SITE = 'youtube';
  const FOCUS_CARD_ID = 'focusguard-focus-card';

  // ============================================================
  //  URL CLASSIFICATION
  // ============================================================

  const PATTERNS = {
    homeFeed:      /^https?:\/\/(www\.)?youtube\.com\/?(\?.*)?$/,
    shorts:        /^https?:\/\/(www\.)?youtube\.com\/shorts\/.+/,
    directVideo:   /^https?:\/\/(www\.)?youtube\.com\/watch\?/,
    search:        /^https?:\/\/(www\.)?youtube\.com\/results\?/,
    channel:       /^https?:\/\/(www\.)?youtube\.com\/(c\/|channel\/|@)[\w-]+/,
    subscriptions: /^https?:\/\/(www\.)?youtube\.com\/feed\/subscriptions/,
    trending:      /^https?:\/\/(www\.)?youtube\.com\/feed\/trending/,
    library:       /^https?:\/\/(www\.)?youtube\.com\/feed\/(library|history|playlists)/,
  };

  function classifyUrl(url) {
    if (PATTERNS.directVideo.test(url))   return 'DIRECT_VIDEO';
    if (PATTERNS.shorts.test(url))        return 'SHORTS';
    if (PATTERNS.search.test(url))        return 'SEARCH';
    if (PATTERNS.subscriptions.test(url)) return 'SUBSCRIPTIONS';
    if (PATTERNS.trending.test(url))      return 'OTHER';
    if (PATTERNS.library.test(url))       return 'OTHER';
    if (PATTERNS.channel.test(url))       return 'CHANNEL';
    if (PATTERNS.homeFeed.test(url))      return 'HOME_FEED';
    return 'OTHER';
  }


  // ============================================================
  //  RECOMMENDATION SELECTORS
  //
  //  These are all algorithmic discovery surfaces — not navigation,
  //  search, or structural page elements. Only these are ever hidden.
  // ============================================================

  // Home feed: algorithmic recommendation grids and shelves.
  // Does NOT include: #masthead, ytd-guide-renderer, ytd-searchbox,
  // #page-manager, ytd-app, ytd-browse — all preserved.
  const HOME_FEED_SELECTORS = [
    'ytd-rich-grid-renderer',          // Main homepage video recommendation grid
    'ytd-reel-shelf-renderer',         // Shorts shelf embedded in homepage feed
    'ytd-rich-shelf-renderer',         // Topic/category shelves (e.g. "Trending")
    'ytd-banner-promo-renderer',       // YouTube promotional banners
    'ytd-statement-banner-renderer',   // Statement-style promo banners
  ];

  // Watch page — non-playlist mode.
  // Primary target: #secondary (the entire right sidebar column).
  // Older YouTube used #related inside #secondary-inner; newer variants
  // removed #related and place ytd-watch-next-secondary-results-renderer
  // directly under #secondary-inner. Targeting #secondary covers both.
  // #primary, #player, ytd-video-*-info-renderer, ytd-comments are untouched.
  const WATCH_SELECTORS_STANDARD = [
    '#secondary',                                    // Top-level right sidebar column (all recs)
    'ytd-watch-next-secondary-results-renderer',     // Fallback: inner rec list
    '#related',                                      // Fallback: older YouTube rec container
    '.ytp-endscreen-content',                        // Endscreen overlay recommendations
    'ytd-compact-autoplay-renderer',                 // Autoplay "Up next" card
  ];

  // Watch page — playlist mode.
  // #secondary is kept visible because ytd-playlist-panel-renderer lives inside it.
  // Only the recommendation-specific children are hidden.
  const WATCH_SELECTORS_PLAYLIST = [
    'ytd-watch-next-secondary-results-renderer',     // Rec list (sibling of playlist panel)
    '#related',                                      // Fallback: older YouTube rec container
    '.ytp-endscreen-content',                        // Endscreen overlay
    'ytd-compact-autoplay-renderer',                 // Autoplay card
  ];

  // ============================================================
  //  ELEMENT HIDING / RESTORING
  //
  //  When hiding: store inline display value in data-fg-display,
  //  then set display:none. Using a dedicated attribute avoids
  //  accidentally clobbering existing inline styles on restore.
  //
  //  When restoring: read data-fg-display and set it back exactly,
  //  then remove both data attributes.
  // ============================================================

  /**
   * Hides a single element by setting display:none.
   * Stores the element's current inline display value in data-fg-display
   * so it can be restored exactly. Skips already-hidden elements.
   */
  function _hideElement(el) {
    if (el.dataset.fgHidden === 'true') return; // Already hidden — skip
    el.dataset.fgDisplay = el.style.display;    // Store inline display (may be '')
    el.dataset.fgHidden = 'true';
    el.style.display = 'none';
  }

  /**
   * Hides all elements matching any of the provided selectors within root.
   * Safe to call repeatedly — already-hidden nodes are skipped via data-fg-hidden.
   *
   * @param {string[]} selectors - CSS selectors for recommendation containers
   * @param {Element|Document} [root=document] - Scope the query to this subtree
   */
  function hideFeedElements(selectors, root) {
    const scope = root || document;
    if (!selectors || selectors.length === 0) return;
    try {
      scope.querySelectorAll(selectors.join(', ')).forEach(_hideElement);
    } catch (e) {
      // Ignore selectors unsupported by the current browser version
    }
  }

  /**
   * Restores all elements previously hidden by FocusGuard.
   * Uses the stored data-fg-display value to restore the exact inline
   * display rather than blindly setting '' (which would override
   * any pre-existing inline display style the page had set).
   */
  function restoreFeedElements() {
    document.querySelectorAll('[data-fg-hidden="true"]').forEach((el) => {
      el.style.display = el.dataset.fgDisplay || ''; // Restore exact prior value
      delete el.dataset.fgHidden;
      delete el.dataset.fgDisplay;
    });
  }

  // ============================================================
  //  FOCUS CARD
  //
  //  Lightweight inline card — NOT fullscreen, NOT modal, NOT fixed.
  //  Inserted as an immediate sibling BEFORE the hidden recommendation
  //  container so it sits naturally in the content flow:
  //
  //    Parent
  //     ├── Focus Card  ← inserted here
  //     └── Hidden Recommendation Grid  ← anchor
  //
  //  Uses Shadow DOM to prevent host-site CSS from interfering.
  // ============================================================

  // CSS variable token sets for the YouTube focus card.
  // applyFocusCardTheme() only swaps variable values on the host element —
  // the structural CSS never changes, avoiding a flash on theme switch.
  function injectFocusCard(anchorElement) {
    const existing = document.getElementById(FOCUS_CARD_ID);

    if (existing) {
      if (anchorElement && anchorElement.parentNode &&
          existing.nextSibling !== anchorElement) {
        anchorElement.parentNode.insertBefore(existing, anchorElement);
      }
      return;
    }

    ThemeManager.init('youtube');

    const host = document.createElement('div');
    host.id = FOCUS_CARD_ID;
    host.style.cssText = 'display:block;width:100%; margin: 16px 0 24px;';
    ThemeManager.applyTheme(host);

    const shadow = host.attachShadow({ mode: 'open' });

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
      @keyframes fgFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
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

    // Create the card container using FGUI
    const card = FG.UI.createCard();
    
    // Override max-width for inline placement
    card.style.maxWidth = '100%';
    card.style.width = '100%';
    card.style.padding = '48px 32px';

    card.appendChild(FG.UI.createLogo());
    card.appendChild(FG.UI.createHeading('Stay Focused'));

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Recommendations are blocked';
    subtitle.style.cssText = `
      font-size: 15px;
      color: var(--fg-text-secondary);
      line-height: 1.6;
      margin-top: var(--fg-spacing-sm);
    `;
    card.appendChild(subtitle);

    shadow.appendChild(card);

    if (anchorElement && anchorElement.parentNode) {
      anchorElement.parentNode.insertBefore(host, anchorElement);
    } else {
      const browse = document.querySelector('ytd-browse') || document.body;
      browse.prepend(host);
    }

    const onThemeChange = () => {
      const existing = document.getElementById(FOCUS_CARD_ID);
      if (existing) ThemeManager.applyTheme(existing);
    };
    ThemeManager.subscribe(onThemeChange);
    host._fgThemeUnsubscribe = () => ThemeManager.unsubscribe(onThemeChange);
  }

  function removeFocusCard() {
    const existing = document.getElementById(FOCUS_CARD_ID);
    if (existing) {
      if (existing._fgThemeUnsubscribe) {
        existing._fgThemeUnsubscribe();
      }
      existing.remove();
    }
  }

  // ============================================================
  //  MUTATION OBSERVER — SPA lazy rendering
  //
  //  YouTube's SPA renders recommendation containers lazily after
  //  navigation. A MutationObserver catches newly added nodes so
  //  they can be hidden before the user sees them.
  //
  //  Design choices:
  //  - Observe document.body (not #primary/#secondary) because
  //    YouTube frequently recreates those containers during SPA nav.
  //  - Scan only mutation.addedNodes (not the full document) to
  //    avoid O(n) document queries on every DOM change.
  //  - Debounce with requestAnimationFrame — YouTube's virtual
  //    scroller can trigger hundreds of mutations per scroll event.
  //  - Always disconnect + null before reassigning to prevent
  //    multiple observers accumulating across page changes.
  // ============================================================

  /** @type {MutationObserver|null} */
  let _suppressionObserver = null;

  /** @type {string[]|null} Active selector list for the current observer */
  let _activeSelectors = null;

  /** @type {number|null} rAF handle for debouncing */
  let _pendingFrame = null;

  /**
   * Accumulated MutationRecord batches between rAF ticks.
   * Without this, observer callback batches that fire while _pendingFrame
   * is already set are silently dropped — causing lazy-rendered recommendation
   * nodes (e.g. #secondary rendered 800ms after SPA navigation) to be missed.
   * @type {MutationRecord[]}
   */
  let _pendingMutations = [];

  /**
   * Disconnects any active MutationObserver and clears associated state.
   * Must be called before starting a new observer or tearing down suppression.
   */
  function _disconnectObserver() {
    if (_suppressionObserver) {
      _suppressionObserver.disconnect();
      _suppressionObserver = null;
    }
    _activeSelectors = null;
    if (_pendingFrame !== null) {
      cancelAnimationFrame(_pendingFrame);
      _pendingFrame = null;
    }
    _pendingMutations = []; // Clear accumulated records for this observer
  }

  /**
   * Checks if a single element (node itself, not its children) matches
   * any of the active selectors, and hides it if so.
   */
  function _checkAndHideNode(node, selectors) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const selector of selectors) {
      try {
        if (node.matches(selector)) {
          _hideElement(node);
          return; // No need to check remaining selectors for this node
        }
      } catch (e) { /* ignore */ }
    }
    // Also scan descendants of the newly added node
    hideFeedElements(selectors, node);
  }

  /**
   * Starts a MutationObserver on document.body to catch recommendation
   * elements that are rendered lazily after initial page paint.
   *
   * @param {string[]} selectors - Selectors to watch for and hide
   */
  function _startObserver(selectors) {
    _disconnectObserver(); // Ensure no stale observer
    _activeSelectors = selectors;

    _suppressionObserver = new MutationObserver((mutations) => {
      // Accumulate every batch so no records are lost between rAF ticks.
      // The earlier implementation dropped batches that arrived while
      // _pendingFrame was already set, missing lazy-rendered recommendations.
      _pendingMutations.push(...mutations);

      if (_pendingFrame !== null) return; // rAF already scheduled — batch is saved above

      _pendingFrame = requestAnimationFrame(() => {
        _pendingFrame = null;
        if (!_activeSelectors) return;

        // Drain the accumulator atomically so records added during this
        // rAF are picked up in the next tick rather than processed twice.
        const batch = _pendingMutations.splice(0);
        for (const mutation of batch) {
          for (const node of mutation.addedNodes) {
            _checkAndHideNode(node, _activeSelectors);
          }
        }
      });
    });

    // document.body is the only stable root across YouTube SPA navigations
    _suppressionObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================================
  //  PLAYLIST DETECTION
  //
  //  Checks both URL and DOM because YouTube occasionally changes
  //  how playlist URLs are formatted. DOM check is a reliable fallback.
  // ============================================================

  /**
   * Returns true if the current page is in a playlist context.
   * Uses URL ?list= param AND DOM presence of ytd-playlist-panel-renderer.
   */
  function isInPlaylistContext() {
    const hasListParam = /[?&]list=/.test(location.search);
    const hasPlaylistPanel = !!document.querySelector('ytd-playlist-panel-renderer');
    return hasListParam || hasPlaylistPanel;
  }

  // ============================================================
  //  SUPPRESSION — HOME FEED
  // ============================================================

  /**
   * Hides homepage recommendation grids and injects an inline focus card.
   * The focus card is inserted as a sibling immediately before the first
   * hidden recommendation container.
   *
   * Navigation, search bar, and left sidebar are untouched.
   */
  function suppressHomeFeed() {
    // Find the first visible recommendation container to use as card anchor
    let anchor = null;
    for (const selector of HOME_FEED_SELECTORS) {
      const found = document.querySelector(selector);
      if (found) { anchor = found; break; }
    }

    // Hide all home-feed recommendation surfaces
    hideFeedElements(HOME_FEED_SELECTORS);

    // Insert focus card before the anchor (sibling relationship)
    injectFocusCard(anchor);

    // Watch for lazily rendered recommendation elements
    _startObserver(HOME_FEED_SELECTORS);
  }

  // ============================================================
  //  SUPPRESSION — WATCH PAGE
  // ============================================================

  /**
   * Hides watch-page recommendation surfaces: sidebar, autoplay, endscreen.
   * Preserves: video player, title, description, channel info, comments.
   *
   * Non-playlist: targets #secondary (entire right column) — the most reliable
   * container, present in all YouTube page variants. Fallbacks cover older
   * DOM shapes where #related wrapped the rec list inside #secondary-inner.
   *
   * Playlist: skips #secondary to keep ytd-playlist-panel-renderer visible;
   * targets only recommendation-specific child elements instead.
   *
   * Staggered retries (400/900/2000ms) handle YouTube's variable render
   * timing for the secondary column after SPA navigation. The MutationObserver
   * catches anything that arrives after the last retry window.
   */
  function suppressWatchRecommendations() {
    const inPlaylist = isInPlaylistContext();
    const selectors = inPlaylist ? WATCH_SELECTORS_PLAYLIST : WATCH_SELECTORS_STANDARD;

    // Initial pass — hides elements already in the DOM at call time
    hideFeedElements(selectors);

    // Observer catches lazily inserted elements (endscreen, autoplay card,
    // and #secondary itself on connections where it renders after 300ms)
    _startObserver(selectors);

    // Staggered retries for elements that render after the player initialises.
    // YouTube's secondary column can appear 500ms–2s after SPA navigation.
    // _activeSelectors being non-null confirms suppression is still active
    // for the current page (cleared by teardownSuppression on any navigation).
    [400, 900, 2000].forEach((delay) => {
      setTimeout(() => {
        if (_activeSelectors) hideFeedElements(_activeSelectors);
      }, delay);
    });
  }

  // ============================================================
  //  FULL TEARDOWN
  // ============================================================

  /**
   * Tears down all active suppression state:
   *   - Disconnects the MutationObserver
   *   - Restores all hidden elements (using stored data-fg-display values)
   *   - Removes the focus card
   *
   * Called at the start of every page navigation to prevent stale
   * hidden states from persisting across page changes.
   */
  function teardownSuppression() {
    _disconnectObserver();
    restoreFeedElements();
    removeFocusCard();
  }

  // ============================================================
  //  PAGE CHANGE HANDLER
  // ============================================================

  function extractShortsId(url) {
    const match = url.match(/\/shorts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  let _previousPageType = null;
  let _previousVideoId = null;

  /**
   * Main entry point for each page navigation.
   * Always tears down previous suppression first, then applies new rules.
   */
  async function handlePageChange(url) {
    const pageType = classifyUrl(url);
    const videoId = pageType === 'SHORTS' ? extractShortsId(url) : null;

    // If it's the exact same Short as before (e.g. redirect/normalization to remove share params), ignore the event.
    if (pageType === 'SHORTS' && _previousPageType === 'SHORTS' && videoId === _previousVideoId && videoId !== null) {
      return;
    }

    // Always reset before applying new-page rules — prevents stale hidden states
    teardownSuppression();

    if (pageType === 'SHORTS') {
      // ---- Shorts: preserve existing fullscreen block behavior ----
      // The consecutive-doomscroll mechanic in background.js (allow first Short,
      // block subsequent) is handled by checkAndBlock → fgCheckAndBlock → fgInjectOverlay.
      // We do not change this path.
      FG.checkAndBlock(SITE, pageType, _previousPageType);

    } else if (pageType === 'HOME_FEED') {
      // ---- Home Feed: suppression model ----
      // Query the background for session/settings state (break mode, chill mode,
      // blockFeed setting) using the same CHECK_DISTRACTION message path.
      // On shouldBlock: hide recommendations + show inline focus card.
      // No fullscreen overlay is shown.
      try {
        const result = await FG.sendMessage({
          type: FG.MSG.CHECK_DISTRACTION,
          site: SITE,
          pageType,
          previousPageType: _previousPageType,
          referrer: document.referrer || '',
        });
        if (result && result.shouldBlock) {
          suppressHomeFeed();
        }
        // If !shouldBlock (break/chill active, or blockFeed=false): do nothing —
        // teardownSuppression() already cleared any prior state above.
      } catch (err) {
        if (!err.message?.includes('Extension context invalidated')) {
          console.warn('[FocusGuard:YouTube] Error checking distraction (HOME_FEED):', err);
        }
      }

    } else if (pageType === 'DIRECT_VIDEO') {
      // ---- Watch Page: sidebar/autoplay/endscreen suppression ----
      // Gated by blockFeed setting (same setting as homepage — both are
      // algorithmic recommendation surfaces from the user's perspective).
      // Send pageType as 'HOME_FEED' so the background evaluates blockFeed.
      try {
        const result = await FG.sendMessage({
          type: FG.MSG.CHECK_DISTRACTION,
          site: SITE,
          pageType: 'HOME_FEED', // Use HOME_FEED to check settings.youtube.blockFeed
          previousPageType: _previousPageType,
          referrer: document.referrer || '',
        });
        if (result && result.shouldBlock) {
          // Call immediately — suppressWatchRecommendations runs its own
          // staggered retries (400/900/2000ms) internally and the
          // MutationObserver handles anything beyond that window.
          suppressWatchRecommendations();
        }
      } catch (err) {
        if (!err.message?.includes('Extension context invalidated')) {
          console.warn('[FocusGuard:YouTube] Error checking distraction (DIRECT_VIDEO):', err);
        }
      }

    } else {
      // ---- All other pages: fully allowed ----
      // search, subscriptions, channel, library, history, playlists, trending.
      // Remove any residual Shorts overlay that may be showing.
      FG.removeOverlay();
    }

    // Update previous page type and ID for the next navigation
    _previousPageType = pageType;
    _previousVideoId = videoId;
  }

  // ============================================================
  //  RUNTIME MESSAGE LISTENER
  //
  //  The background sends UNBLOCK_PAGE when a break or chill session
  //  starts, and BREAK_ENDED when a break timer expires.
  //  For the overlay model (Instagram, Shorts), content-common.js
  //  handles these by calling fgRemoveOverlay().
  //  For the suppression model (YouTube home/watch), we re-evaluate
  //  the current page so suppression is correctly applied or lifted.
  // ============================================================

  const _api = (typeof browser !== 'undefined') ? browser : chrome;

  _api.runtime.onMessage.addListener((message) => {
    if (
      message.type === FG.MSG.UNBLOCK_PAGE ||
      message.type === FG.MSG.BREAK_ENDED
    ) {
      // Re-run page handler with the current URL.
      // This re-checks shouldBlock against the updated session state and
      // either tears down suppression (break/chill active → shouldBlock false)
      // or re-applies it (break ended → shouldBlock true again).
      handlePageChange(location.href);
    }
  });

  // ============================================================
  //  BOOTSTRAP
  // ============================================================

  // SPA navigation: background fires URL_CHANGED via webNavigation API,
  // content-common.js relays it to all registered onUrlChange callbacks.
  FG.onUrlChange(handlePageChange);

  // Initial check on script injection (page load / extension enable)
  handlePageChange(location.href);
})();
