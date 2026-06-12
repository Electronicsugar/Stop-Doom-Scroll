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

  function handlePageChange(url) {
    const pageType = classifyUrl(url);
    console.log('[FocusGuard:YouTube] Page:', pageType, url);

    // Only check distraction for potentially distracting page types
    if (pageType === 'HOME_FEED' || pageType === 'SHORTS') {
      FG.checkAndBlock(SITE, pageType);
    } else {
      // Not a distracting page - remove any existing overlay
      FG.removeOverlay();
    }
  }

  // Listen for URL changes
  FG.onUrlChange(handlePageChange);

  // Initial check on load
  handlePageChange(location.href);

  console.log('[FocusGuard:YouTube] Content script loaded');
})();
