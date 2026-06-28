/* FocusGuard — Instagram Content Script (Plain Script / IIFE)
 *
 * Intentional Usage Model:
 *   HOME_FEED   → Suppress algorithmic feed posts; keep Stories bar, nav, DMs
 *   EXPLORE     → Suppress explore grid + trending; keep search bar functional
 *   SEARCH      → Suppress trending/suggested content; allow account search results
 *   REELS / REELS_FEED / SINGLE_REEL → Full block via FG.checkAndBlock() (unchanged)
 *   All others  → No suppression; full access
 *
 * instagram.blockFeed gates HOME_FEED, EXPLORE, and SEARCH suppression.
 * instagram.blockReels gates Reels independently.
 */

(function () {
  'use strict';

  const FG = window.__FG;
  if (!FG) { console.error('[FocusGuard] Common script not loaded'); return; }

  const SITE = 'instagram';
  const FOCUS_CARD_ID = 'focusguard-ig-focus-card';

  // ============================================================
  //  URL CLASSIFICATION
  //
  //  Instagram URL shapes:
  //    /                          → home feed
  //    /reels/                    → reels browse (distracting)
  //    /reels/XXXX                → specific reel in feed (distracting)
  //    /reel/XXXX                 → single shared reel (distracting)
  //    /p/XXXX                    → direct post (intentional)
  //    /stories/username/         → stories (intentional)
  //    /explore/                  → explore grid (semi-distracting)
  //    /explore/search/keyword/   → explore search results (semi-distracting)
  //    /direct/                   → DMs (intentional)
  //    /username/                 → profile (intentional)
  // ============================================================

  const PATTERNS = {
    reelsPage:  /^https?:\/\/(www\.)?instagram\.com\/reels\/?(\\?.*)?$/,
    reelsFeed:  /^https?:\/\/(www\.)?instagram\.com\/reels\/[\w-]+/,
    singleReel: /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+/,
    directPost: /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/,
    stories:    /^https?:\/\/(www\.)?instagram\.com\/stories\/[\w.-]+/,
    explore:    /^https?:\/\/(www\.)?instagram\.com\/explore\/?/,
    direct:     /^https?:\/\/(www\.)?instagram\.com\/direct\//,
    homeFeed:   /^https?:\/\/(www\.)?instagram\.com\/?(\\?.*)?$/,
  };

  function classifyUrl(url) {
    // Order matters — more specific patterns before more general ones
    if (PATTERNS.directPost.test(url))  return 'DIRECT_POST';
    if (PATTERNS.singleReel.test(url))  return 'SINGLE_REEL';
    if (PATTERNS.reelsFeed.test(url))   return 'REELS_FEED';
    if (PATTERNS.reelsPage.test(url))   return 'REELS';
    if (PATTERNS.stories.test(url))     return 'STORIES';
    if (PATTERNS.explore.test(url))     return 'EXPLORE';
    if (PATTERNS.direct.test(url))      return 'DIRECT_MSG';
    if (PATTERNS.homeFeed.test(url))    return 'HOME_FEED';
    // Anything else is a profile page or other intentional destination
    return 'PROFILE';
  }

  // ============================================================
  //  RECOMMENDATION SELECTORS
  //
  //  Instagram renders via React with generated class names — these
  //  change frequently. Attribute and role selectors are used wherever
  //  possible. Tag + aria + data attributes are the most stable anchors.
  //
  //  Selectors are annotated with what they target and why they are safe
  //  to hide (i.e. they are recommendation surfaces, not structural nav).
  // ============================================================

  // ---- Home Feed ----
  // The Instagram home feed is a single scrolling list. The strategy is to
  // hide each individual post-card that is algorithmically injected rather
  // than hiding a single wrapper (which may not exist or may include Stories).
  //
  // Preserved: left nav, Stories tray (header), right sidebar (suggestions
  // are an exception — see below), DM icon, notification icon, Create button.
  //
  // Instagram's main content column is the <main> element. The Stories bar
  // sits at the top inside <main>. Feed posts are article[role="presentation"]
  // or article elements immediately under the scrollable list.
  //
  // Suggested-posts sections (injected mid-feed) have a header element with
  // aria-label containing "Suggested" — we use that to anchor suppression.
  const HOME_FEED_SELECTORS = [
    // Each feed post is rendered as <article> inside <main>
    // We hide the <div> that wraps the entire scrollable feed column to remove
    // all algorithmically ranked posts at once. This is the most reliable
    // anchor because Instagram re-renders individual articles on scroll.
    //
    // Instagram's main scrollable feed container sits inside the <main> tag
    // and is the first large div child. We scope to [role="main"] or <main>
    // to avoid touching the left nav or right sidebar.
    //
    // Approach: hide the feed article list directly. The Stories tray is a
    // separate sibling div and is NOT hidden.

    // Primary: each feed article (post card)
    // Instagram wraps each post in <article> — this is stable across versions.
    // We hide article elements that are direct or near-direct children of
    // the main scrollable region (not in Stories or in the right sidebar).
    'main article',                    // Feed post cards (each individual post)

    // Suggested posts / suggested accounts injected mid-feed
    // These appear as labelled sections with "Suggested for you" headers.
    // They are <div> containers with a header-level element inside.
    // Targeting by aria-label on the section wrapper is the most stable approach.
    'main [aria-label="Suggested for you"]',    // Suggested posts section
    'main [data-testid="suggested_posts"]',      // Suggested posts (test id variant)
  ];

  // ---- Explore Page ----
  // The explore page is a grid of algorithmically selected media.
  // We hide the entire explore grid but keep the search bar at the top.
  //
  // The explore grid is rendered in a <main> element. The search bar / input
  // at the top of /explore/ is a separate element and is preserved.
  //
  // /explore/search/ sub-pages show search results — handled separately below.
  const EXPLORE_SELECTORS = [
    // Explore media grid — the scrollable photo/video grid
    'main [role="presentation"]',      // Explore grid items (each thumbnail cell)
    'main ._aabd',                     // Explore grid container (common class, fallback)

    // Trending searches / suggested hashtags shown before user types
    'main [aria-label="Trending searches"]',
    'main [aria-label="Recent searches"]',  // Recent searches can be a gateway to explore
  ];

  // ---- Search / Explore Search Page ----
  // On /explore/search/ Instagram shows:
  //   - Before typing: trending searches, suggested accounts, explore-style content
  //   - After typing: account results, reel results, audio results, place results
  //
  // Strategy:
  //   - Always hide: trending searches, reels results in search, audio/video results
  //   - When query is present: show account results (people), hide everything else
  //   - When no query: hide everything except the search input itself
  //
  // We cannot easily distinguish "account result" from "reel result" via a single
  // selector since both are rendered as <a> tags inside result lists. Instead we
  // hide the SECTIONS that are labelled as reels/audio/places/hashtags, and keep
  // sections labelled as accounts/people.
  const SEARCH_SECTIONS_TO_HIDE = [
    // Section headers that indicate non-account recommendation content in search
    '[aria-label="Reels"]',
    '[aria-label="IGTV"]',
    '[aria-label="Videos"]',
    '[aria-label="Audio"]',
    '[aria-label="Places"]',
    '[aria-label="Tags"]',
    '[aria-label="Trending"]',
    '[aria-label="Suggested"]',
    // Trending/recent searches panel shown before a query is typed
    '[aria-label="Trending searches"]',
    '[aria-label="Recent searches"]',
    // Generic "see more" explore links at bottom of search
    '[aria-label="See more results in Explore"]',
  ];

  // ---- Right sidebar suggested accounts (visible on home feed in wide viewport) ----
  // Instagram shows a "Suggested for you" panel in the right sidebar.
  // This is a recommendation surface and is hidden.
  // The sidebar also contains the logged-in user's own profile link and nav links
  // — those are inside a separate element and are preserved.
  const SIDEBAR_SELECTORS = [
    // The right sidebar's suggested accounts section
    // On Instagram, the right sidebar contains both the user identity block
    // (avatar + username) and a list of suggested accounts below it.
    // The suggested accounts list has an aria-label "Suggested for you" or
    // is wrapped in a <section> with that text.
    '[aria-label="Suggested for you"]',   // Suggested accounts sidebar section
  ];

  // ============================================================
  //  ELEMENT HIDING / RESTORING
  //  Same pattern as content-youtube.js:
  //  — store prior inline display in data-fg-display
  //  — mark with data-fg-hidden="true"
  //  — restore exact inline display on teardown
  // ============================================================

  function _hideElement(el) {
    if (el.dataset.fgHidden === 'true') return;
    el.dataset.fgDisplay = el.style.display;
    el.dataset.fgHidden = 'true';
    el.style.display = 'none';
  }

  /**
   * Hides all elements matching any selector within root (default: document).
   * Safe to call repeatedly — already-hidden nodes are skipped.
   *
   * @param {string[]} selectors
   * @param {Element|Document} [root=document]
   */
  function hideFeedElements(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      try {
        scope.querySelectorAll(selector).forEach(_hideElement);
      } catch (e) {
        // Ignore invalid selectors (browser-version CSS differences)
      }
    }
  }

  /**
   * Restores all elements hidden by FocusGuard.
   * Uses data-fg-display to restore the exact prior inline display value.
   */
  function restoreFeedElements() {
    document.querySelectorAll('[data-fg-hidden="true"]').forEach((el) => {
      el.style.display = el.dataset.fgDisplay || '';
      delete el.dataset.fgHidden;
      delete el.dataset.fgDisplay;
    });
  }

  // ============================================================
  //  FOCUS CARD
  //  Inline card — NOT fullscreen, NOT modal, NOT fixed.
  //  Inserted immediately before the first hidden recommendation container.
  //
  //    Parent
  //     ├── Focus Card   ← inserted here
  //     └── Hidden Feed  ← anchor
  //
  //  Uses Shadow DOM to prevent Instagram's CSS from interfering.
  // ============================================================

  /**
   * Injects an inline focus card before anchorElement.
   * If the card already exists, repositions it instead of recreating it.
   *
   * @param {Element|null} anchorElement
   * @param {string} [subtitle]
   */
  function injectFocusCard(anchorElement, subtitle) {
    const existing = document.getElementById(FOCUS_CARD_ID);

    if (existing) {
      if (anchorElement && anchorElement.parentNode &&
          existing.nextSibling !== anchorElement) {
        anchorElement.parentNode.insertBefore(existing, anchorElement);
      }
      return;
    }

    const host = document.createElement('div');
    host.id = FOCUS_CARD_ID;
    host.style.cssText = 'display:block;width:100%;';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .fg-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 32px;
        margin: 16px 0 24px;
        background: linear-gradient(135deg,
          rgba(124, 58, 237, 0.07) 0%,
          rgba(59, 130, 246, 0.05) 100%);
        border: 1px solid rgba(124, 58, 237, 0.18);
        border-radius: 20px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        text-align: center;
        animation: fgFadeIn 0.35s ease;
      }
      .fg-icon { font-size: 40px; margin-bottom: 14px; filter: drop-shadow(0 4px 10px rgba(124,58,237,0.3)); }
      .fg-title { font-size: 20px; font-weight: 700; color: #e2e8f0; margin-bottom: 8px; }
      .fg-sub { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.65; max-width: 360px; margin-bottom: 20px; }
      .fg-chips { display: inline-flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .fg-chip {
        background: rgba(124,58,237,0.14);
        border: 1px solid rgba(124,58,237,0.25);
        border-radius: 20px;
        padding: 5px 14px;
        font-size: 12px;
        font-weight: 500;
        color: #c4b5fd;
      }
      @keyframes fgFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'fg-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-label', 'FocusGuard: Recommendations hidden');

    const icon = document.createElement('span');
    icon.className = 'fg-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🛡️';

    const title = document.createElement('h2');
    title.className = 'fg-title';
    title.textContent = 'Stay Focused';

    const sub = document.createElement('p');
    sub.className = 'fg-sub';
    sub.textContent = subtitle || 'Recommendations are hidden. Use intentional navigation.';

    const chips = document.createElement('div');
    chips.className = 'fg-chips';
    const hints = ['💬 Messages', '📖 Stories', '🔔 Notifications', '🔍 Search accounts', '👤 Profile'];
    hints.forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'fg-chip';
      chip.textContent = label;
      chips.appendChild(chip);
    });

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(chips);
    shadow.appendChild(card);

    if (anchorElement && anchorElement.parentNode) {
      anchorElement.parentNode.insertBefore(host, anchorElement);
    } else {
      // Fallback: prepend to main content area or body
      const main = document.querySelector('main') || document.body;
      main.prepend(host);
    }
  }

  function removeFocusCard() {
    const existing = document.getElementById(FOCUS_CARD_ID);
    if (existing) existing.remove();
  }

  // ============================================================
  //  MUTATION OBSERVER — Dynamic content insertion
  //
  //  Instagram is a React SPA that renders content lazily and injects
  //  feed posts incrementally as the user scrolls. The observer ensures
  //  newly inserted recommendation elements are hidden immediately.
  //
  //  - Observe document.body (not main) — Instagram recreates <main>
  //    and its children during SPA navigation.
  //  - Accumulate mutation batches in _pendingMutations to prevent
  //    records being dropped when rAF is already scheduled.
  //  - Scan only mutation.addedNodes for performance.
  //  - Always disconnect + null before reassigning.
  // ============================================================

  /** @type {MutationObserver|null} */
  let _suppressionObserver = null;

  /** @type {string[]|null} */
  let _activeSelectors = null;

  /** @type {number|null} */
  let _pendingFrame = null;

  /** @type {MutationRecord[]} */
  let _pendingMutations = [];

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
    _pendingMutations = [];
  }

  function _checkAndHideNode(node, selectors) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const selector of selectors) {
      try {
        if (node.matches(selector)) {
          _hideElement(node);
          return;
        }
      } catch (e) { /* ignore */ }
    }
    // Scan descendants of the added node
    hideFeedElements(selectors, node);
  }

  function _startObserver(selectors) {
    _disconnectObserver();
    _activeSelectors = selectors;

    _suppressionObserver = new MutationObserver((mutations) => {
      // Accumulate all batches — prevents records being dropped when
      // _pendingFrame is already set (same fix as content-youtube.js).
      _pendingMutations.push(...mutations);

      if (_pendingFrame !== null) return;

      _pendingFrame = requestAnimationFrame(() => {
        _pendingFrame = null;
        if (!_activeSelectors) return;

        const batch = _pendingMutations.splice(0);
        for (const mutation of batch) {
          for (const node of mutation.addedNodes) {
            _checkAndHideNode(node, _activeSelectors);
          }
        }
      });
    });

    // document.body is the only stable root across Instagram SPA navigations
    _suppressionObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================================
  //  TEARDOWN
  // ============================================================

  function teardownSuppression() {
    _disconnectObserver();
    restoreFeedElements();
    removeFocusCard();
  }

  // ============================================================
  //  SEARCH QUERY DETECTION
  //  On /explore/search/ Instagram reflects the user's search query in
  //  the URL (?q=...) or in a visible search input. We read the URL
  //  parameter to decide whether to suppress all content or only
  //  non-account recommendation sections.
  // ============================================================

  function getSearchQuery() {
    try {
      return new URL(location.href).searchParams.get('q') || '';
    } catch (e) {
      return '';
    }
  }

  // ============================================================
  //  SUPPRESSION — HOME FEED
  //
  //  Hides individual feed post cards inside <main>.
  //  The Stories bar (a separate div above the posts) is preserved.
  //  The right-sidebar suggested accounts section is also hidden.
  //
  //  Focus card is inserted before the first feed article.
  // ============================================================

  function suppressHomeFeed() {
    const allSelectors = [...HOME_FEED_SELECTORS, ...SIDEBAR_SELECTORS];

    const anchor = document.querySelector('main article');

    hideFeedElements(allSelectors);
    injectFocusCard(
      anchor,
      'Your home feed is hidden. Use Stories, Search, Messages, or visit profiles directly.'
    );

    _startObserver(allSelectors);

    // Staggered retries — Instagram renders feed posts incrementally
    [400, 900, 2000].forEach((delay) => {
      setTimeout(() => {
        if (_activeSelectors) hideFeedElements(_activeSelectors);
      }, delay);
    });
  }

  // ============================================================
  //  SUPPRESSION — EXPLORE PAGE
  //
  //  Hides the explore media grid and trending searches.
  //  Preserves the search input at the top of /explore/.
  //
  //  Focus card is prepended into <main>.
  // ============================================================

  function suppressExplorePage() {
    const anchor = document.querySelector('main [role="presentation"]') ||
                   document.querySelector('main');

    hideFeedElements(EXPLORE_SELECTORS);
    injectFocusCard(
      anchor,
      'The Explore grid is hidden. Use the search bar to find specific accounts.'
    );

    _startObserver(EXPLORE_SELECTORS);

    [400, 900, 2000].forEach((delay) => {
      setTimeout(() => {
        if (_activeSelectors) hideFeedElements(_activeSelectors);
      }, delay);
    });
  }

  // ============================================================
  //  SUPPRESSION — SEARCH PAGE
  //
  //  Two modes:
  //  1. No query typed → hide all suggestion/trending sections
  //  2. Query typed    → hide reels/media/audio sections; keep account results
  //
  //  The search input itself is never hidden.
  //  The observer watches for dynamically injected suggestion sections.
  // ============================================================

  function suppressSearchPage() {
    const query = getSearchQuery();

    const selectors = query
      // Query present: only hide non-account recommendation sections
      ? SEARCH_SECTIONS_TO_HIDE
      // No query: hide all content below the search bar
      : [...SEARCH_SECTIONS_TO_HIDE, 'main [role="presentation"]', 'main article'];

    hideFeedElements(selectors);
    _startObserver(selectors);

    [400, 900, 2000].forEach((delay) => {
      setTimeout(() => {
        if (_activeSelectors) hideFeedElements(_activeSelectors);
      }, delay);
    });
  }

  // ============================================================
  //  PAGE CHANGE HANDLER
  // ============================================================

  let _previousPageType = null;

  async function handlePageChange(url) {
    const pageType = classifyUrl(url);
    console.log(`[FocusGuard:Instagram] Page: ${pageType} (Previous: ${_previousPageType}) | ${url}`);

    // Always tear down before applying new rules
    teardownSuppression();

    const reelTypes = ['REELS', 'REELS_FEED', 'SINGLE_REEL'];

    if (reelTypes.includes(pageType)) {
      // ---- Reels: preserve existing fullscreen block behavior ----
      // The consecutive-doomscroll mechanic (allow first Reel, block subsequent)
      // lives in the background's checkDistraction() and is handled by checkAndBlock.
      FG.checkAndBlock(SITE, pageType, _previousPageType);

    } else if (pageType === 'HOME_FEED') {
      // ---- Home Feed: suppression model ----
      // Gated by instagram.blockFeed.
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
      } catch (err) {
        console.warn('[FocusGuard:Instagram] Error checking distraction (HOME_FEED):', err);
      }

    } else if (pageType === 'EXPLORE') {
      // ---- Explore: suppression model ----
      // Gated by instagram.blockFeed (EXPLORE is checked against blockFeed in background).
      // Distinguish between /explore/ (grid) and /explore/search/ (search results).
      const isSearchSubpage = /\/explore\/search/i.test(url) ||
                              /\/explore\/tags/i.test(url);
      try {
        const result = await FG.sendMessage({
          type: FG.MSG.CHECK_DISTRACTION,
          site: SITE,
          pageType,
          previousPageType: _previousPageType,
          referrer: document.referrer || '',
        });
        if (result && result.shouldBlock) {
          if (isSearchSubpage) {
            suppressSearchPage();
          } else {
            suppressExplorePage();
          }
        }
      } catch (err) {
        console.warn('[FocusGuard:Instagram] Error checking distraction (EXPLORE):', err);
      }

    } else {
      // ---- All other pages: fully intentional — no suppression ----
      // DIRECT_POST, STORIES, DIRECT_MSG, PROFILE, and any unknown page
      // types are allowed unconditionally. Remove any residual overlay
      // (e.g. a Reels overlay that was showing before navigating here).
      FG.removeOverlay();
    }

    _previousPageType = pageType;
  }

  // ============================================================
  //  RUNTIME MESSAGE LISTENER
  //
  //  UNBLOCK_PAGE fires when break or chill mode starts.
  //  BREAK_ENDED fires when a break timer expires.
  //  Re-evaluate the current page so suppression is lifted or reapplied.
  // ============================================================

  const _api = (typeof browser !== 'undefined') ? browser : chrome;

  _api.runtime.onMessage.addListener((message) => {
    if (message.type === FG.MSG.UNBLOCK_PAGE || message.type === FG.MSG.BREAK_ENDED) {
      handlePageChange(location.href);
    }
  });

  // ============================================================
  //  BOOTSTRAP
  // ============================================================

  FG.onUrlChange(handlePageChange);
  handlePageChange(location.href);

  console.log('[FocusGuard:Instagram] Content script loaded — Intentional Usage Model active');
})();
