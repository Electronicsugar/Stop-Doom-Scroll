# Project State

## Current Version: v1.2.1

## Completed Features
- **Foundation**: MV3 `manifest.json`, cross-browser storage abstraction, shared constants.
- **Background Worker**: Session management (start/end logic), message routing, distraction checking logic, and background break timer via `chrome.alarms`.
- **Popup UI**: Dark glassmorphism interface with views for Goal Prompt, Task List (CRUD), Break CAPTCHA challenge, Timer Picker, and Active Break Countdown. Break CTA banner automatically hides when break button is disabled.
- **Universal Website Blocker**: Custom domain, path, exact, and wildcard URL blocking rules with high-contrast glassmorphic overlay matching Sage aesthetic (`SAGE` header, leaf SVG, Playfair Display heading, pill badge, compact primary `← Go Back` pill button). Fully unblocks during active break mode with zero-flash fast-path session caching.
- **Content Scripts**: 
  - Shared Shadow DOM overlay injection.
  - SPA URL change detection (MutationObserver + popstate).
  - YouTube URL classification (blocking Home Feed, Shorts).
  - Instagram URL classification (blocking Home Feed, Reels, Explore).
- **Settings Panel**: Full-page UI to toggle specific block rules, break functionality, goal inference, theme selector (with vector SVG 50/50 auto dot), and custom blocked websites section with interactive match type help tooltips (`?`).
- **Settings Lock**: Password protection for Settings page with instant direct unlock prompt on toggle off or edit.
- **Auto-Chill Mode**: Automatic leisure detection — if no goals and no tasks exist when visiting a distracting site, chill mode activates. Deactivates when a goal is set or a task is added.
- **Codebase Optimization & Deduplication**: Extracted shared design system tokens, keyframe animations, typography, resets, standard buttons, form inputs, modals, and custom scrollbars into `lib/common.css`. Standardized content script DOM hiding/restoring helpers across YouTube & Instagram, and removed dead script tags & orphan zip files.
- **Project Skills**: Dedicated `.agents/skills` for `version_control` and `commit` workflows.

## Features In Progress
- None currently.

## Known Bugs
- **[FIXED]** Multi-millisecond block screen flash on Universal Blocker sites during active breaks — fixed via fast-path session caching.
- **[FIXED]** Break CTA banner remaining in popup when break button is disabled — fixed by hiding entire `#popup-footer` container.
- **[FIXED]** Goal inference never extracted actual search queries from URLs — now uses 3-tier strategy (search query → cleaned title → domain topic).
- **[FIXED]** Settings "Blocked Websites" (Universal Blocker) UI had broken undefined CSS variable references, bad light mode contrast, missing Enter key handling, and lacked Settings Lock protection.
- **[FIXED]** Disabling Settings Lock didn't pass password to background, leaving lock enabled on refresh. Now verifies password, resets/clears password hash completely on toggle off, and applies specific pending toggle changes upon unlocking.

## Pending Tasks
- **Icon Generation**: The current icons are duplicates of a single high-res image. Need to be properly resized to 16x16, 32x32, 48x48, 128x128 pixels.
- **Firefox Testing**: Verify MV3 compatibility and storage behavior on Mozilla Firefox.
- **Edge Cases**: Test rapid tab switching, browser restarts during active breaks, and single-page application (SPA) routing robustness.

## Technical Debt
- None currently.

## Next Recommended Tasks
1. Load the extension manually into Chrome and verify all flows (Goal setting, YouTube blocking, Break timer, Auto-chill mode).
2. Create properly sized icon files.
