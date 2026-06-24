/* FocusGuard — YouTube Content Script (Plain Script) */

(function() {
  'use strict';

  const FG = window.__FG;
  if (!FG) { console.error('[FocusGuard] Common script not loaded'); return; }

  const SITE = 'youtube';

  // URL classification patterns
  const PATTERNS = {
    homeFeed: /^https?:\/\/(www\.)?youtube\.com\/?(\?.*)?$/,
    shorts: /^https?:\/\/(www\.)?youtube\.com\/shorts\/.+/,
    directVideo: /^https?:\/\/(www\.)?youtube\.com\/watch\?/,
    search: /^https?:\/\/(www\.)?youtube\.com\/results\?/,
    channel: /^https?:\/\/(www\.)?youtube\.com\/(c\/|channel\/|@)[\w-]+/,
    subscriptions: /^https?:\/\/(www\.)?youtube\.com\/feed\/subscriptions/,
    trending: /^https?:\/\/(www\.)?youtube\.com\/feed\/trending/,
    library: /^https?:\/\/(www\.)?youtube\.com\/feed\/(library|history|playlists)/,
  };

  function classifyUrl(url) {
    if (PATTERNS.directVideo.test(url)) return 'DIRECT_VIDEO';
    if (PATTERNS.shorts.test(url)) return 'SHORTS';
    if (PATTERNS.search.test(url)) return 'SEARCH';
    if (PATTERNS.subscriptions.test(url)) return 'SUBSCRIPTIONS';
    if (PATTERNS.trending.test(url)) return 'OTHER';
    if (PATTERNS.library.test(url)) return 'OTHER';
    if (PATTERNS.channel.test(url)) return 'CHANNEL';
    if (PATTERNS.homeFeed.test(url)) return 'HOME_FEED';
    return 'OTHER';
  }

  function extractShortsId(url) {
    const match = url.match(/\/shorts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  let _previousPageType = null;
  let _previousVideoId = null;

  function handlePageChange(url) {
    const pageType = classifyUrl(url);
    const videoId = pageType === 'SHORTS' ? extractShortsId(url) : null;
    
    console.log(`[FocusGuard:YouTube] Page: ${pageType} (Previous: ${_previousPageType}) | ID: ${videoId} | URL: ${url}`);

    // If it's the exact same Short as before (e.g. redirect/normalization to remove share params), ignore the event.
    if (pageType === 'SHORTS' && _previousPageType === 'SHORTS' && videoId === _previousVideoId && videoId !== null) {
      console.log('[FocusGuard:YouTube] Ignoring URL normalization for the same video ID.');
      return;
    }

    // Only check distraction for potentially distracting page types
    if (pageType === 'HOME_FEED' || pageType === 'SHORTS') {
      FG.checkAndBlock(SITE, pageType, _previousPageType);
    } else {
      // Not a distracting page - remove any existing overlay
      FG.removeOverlay();
    }

    // Update previous page type and ID for the next navigation
    _previousPageType = pageType;
    _previousVideoId = videoId;
  }

  // Listen for URL changes
  FG.onUrlChange(handlePageChange);

  // Initial check on load
  handlePageChange(location.href);

  console.log('[FocusGuard:YouTube] Content script loaded');
})();
