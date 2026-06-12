# Architecture Decision Records (ADRs)

## 1. Extension Manifest Version
- **Problem**: Need to choose an extension platform version.
- **Options considered**: Manifest V2 vs Manifest V3.
- **Chosen solution**: Manifest V3.
- **Reasoning**: Manifest V2 is deprecated and being phased out across major browsers. MV3 ensures long-term viability and store acceptance.
- **Tradeoffs**: MV3 service workers can sleep, requiring more robust state persistence and asynchronous event handling compared to MV2 persistent background pages.

## 2. Technology Stack & UI Framework
- **Problem**: Need to decide how to build the UI (Popup, Settings, Overlays).
- **Options considered**: React/Tailwind, Vue, Vanilla JS/CSS.
- **Chosen solution**: Vanilla JS, HTML, and CSS.
- **Reasoning**: The extension needs to be extremely fast, lightweight, and have minimal startup time. A premium aesthetic can be achieved with raw CSS without the overhead of a VDOM or bundler.
- **Tradeoffs**: More manual DOM manipulation and state synchronization logic is required compared to declarative frameworks.

## 3. Overlay Injection Strategy
- **Problem**: How to block distracting content on host sites (YouTube, Instagram) without full redirects, while maintaining custom styling.
- **Options considered**: 
  - URL Redirects (blocks whole site).
  - Direct DOM mutation (CSS bleeding from host).
  - iFrame injection.
  - Shadow DOM overlay.
- **Chosen solution**: Shadow DOM overlay.
- **Reasoning**: Isolates the extension's premium CSS from the host site's CSS, ensuring the block screen always looks perfect. Less heavy than an iframe. Allows intentional blocking without redirecting away from the URL.
- **Tradeoffs**: Events inside Shadow DOM require specific handling.

## 4. Privacy & Goal Inference Tracking
- **Problem**: How to infer a user's goal based on activity without being overly intrusive.
- **Options considered**: `history` permission (full browsing history) vs `tabs` permission (current activity).
- **Chosen solution**: `tabs` permission with a short-lived rolling buffer in `chrome.storage.local`.
- **Reasoning**: The user explicitly requested to avoid full browsing history. Storing a temporary rolling buffer of recent active tabs is sufficient to infer context (working vs distracted) without permanently tracking the user.
- **Tradeoffs**: Goal inference is limited to very recent activity.

## 5. Break Timer Display
- **Problem**: Where to show the active break countdown.
- **Options considered**: Floating widget on the page vs inside the Extension Popup.
- **Chosen solution**: Inside the Extension Popup.
- **Reasoning**: Floating widgets can break site layouts and be annoying. Keeping it in the popup menu keeps the extension unobtrusive while still allowing the user to check their remaining time.
- **Tradeoffs**: User has to click the extension icon to see exactly how much time is left.
