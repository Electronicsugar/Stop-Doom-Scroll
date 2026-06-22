/* FocusGuard — Instagram Content Script (Plain Script) */

(function() {
  'use strict';

  const FG = window.__FG;
  if (!FG) { console.error('[FocusGuard] Common script not loaded'); return; }

  const SITE = 'instagram';

  // URL classification patterns
  // Instagram URLs:
  // / → home feed
  // /reels/ → reels browse page (distracting)
  // /reels/XXXXX → specific reel in reels feed (distracting)
  // /reel/XXXXX → single shared reel (potentially shared, check referrer)
  // /p/XXXXX → direct post
  // /stories/username/ → stories
  // /explore/ → explore page (distracting)
  // /direct/ → DMs
  // /username/ → profile

  const PATTERNS = {
    reelsPage: /^https?:\/\/(www\.)?instagram\.com\/reels\/?(\?.*)?$/,
    reelsFeed: /^https?:\/\/(www\.)?instagram\.com\/reels\/[\w-]+/,
    singleReel: /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+/,
    directPost: /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/,
    stories: /^https?:\/\/(www\.)?instagram\.com\/stories\/[\w.-]+/,
    explore: /^https?:\/\/(www\.)?instagram\.com\/explore\/?/,
    direct: /^https?:\/\/(www\.)?instagram\.com\/direct\//,
    homeFeed: /^https?:\/\/(www\.)?instagram\.com\/?(\?.*)?$/,
  };

  function classifyUrl(url) {
    // Order matters — more specific patterns first
    if (PATTERNS.directPost.test(url)) return 'DIRECT_POST';
    if (PATTERNS.singleReel.test(url)) return 'SINGLE_REEL';
    if (PATTERNS.reelsFeed.test(url)) return 'REELS_FEED';
    if (PATTERNS.reelsPage.test(url)) return 'REELS';
    if (PATTERNS.stories.test(url)) return 'STORIES';
    if (PATTERNS.explore.test(url)) return 'EXPLORE';
    if (PATTERNS.direct.test(url)) return 'DIRECT_MSG';
    if (PATTERNS.homeFeed.test(url)) return 'HOME_FEED';
    // Anything else is likely a profile page
    return 'PROFILE';
  }

  let _previousPageType = null;

  function handlePageChange(url) {
    const pageType = classifyUrl(url);
    console.log(`[FocusGuard:Instagram] Page: ${pageType} (Previous: ${_previousPageType}) | ${url}`);

    const distractingTypes = ['HOME_FEED', 'REELS', 'REELS_FEED', 'SINGLE_REEL', 'EXPLORE'];
    if (distractingTypes.includes(pageType)) {
      FG.checkAndBlock(SITE, pageType, _previousPageType);
    } else {
      FG.removeOverlay();
    }

    _previousPageType = pageType;
  }

  // Listen for URL changes
  FG.onUrlChange(handlePageChange);

  // Initial check on load
  handlePageChange(location.href);

  console.log('[FocusGuard:Instagram] Content script loaded');
})();
