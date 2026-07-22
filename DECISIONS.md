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

## 6. Automatic Chill Mode
- **Problem**: How to handle the case where a user opens their browser and goes straight to YouTube/Instagram without any work intent (no goals, no tasks).
- **Options considered**:
  - Overlay prompt asking "Do you want to chill?" (manual opt-in).
  - Popup toggle button for chill mode.
  - Automatic detection based on absence of goals and tasks.
- **Chosen solution**: Automatic detection. If `sessionGoal` is null and there are no active (uncompleted) todos, the first visit to a blocked page auto-enables chill mode.
- **Reasoning**: The user's intent is clear — if they have nothing to work on and go straight to leisure content, blocking them adds no value. Auto-detection eliminates unnecessary friction. Chill mode is disabled the moment a goal is set or a task is added, restoring blocking immediately.
- **Tradeoffs**: A user who *intended* to work but forgot to set a goal will not be blocked until they add a goal or task. This is acceptable because the extension's philosophy is "not a full blocker" — it only intervenes when there is a clear work context.

## 7. Unified Design System & Common Module Consolidation
- **Problem**: How to reduce CSS/JS redundancy and file bloat across popup, settings, and content scripts before production release.
- **Options considered**:
  - Keep separate CSS/JS per page with duplicated tokens and rules.
  - Create a unified `lib/common.css` and export shared DOM helpers in `content-common.js`.
- **Chosen solution**: Centralized design system stylesheet (`lib/common.css`) and shared DOM helpers on `window.__FG`.
- **Reasoning**: Cuts CSS code volume by ~50%, standardizes color tokens, keyframe animations, typography, resets, button components, form controls, and custom scrollbars across all pages, while maintaining fast load times without any external bundlers.

