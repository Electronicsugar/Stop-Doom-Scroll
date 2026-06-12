# FocusGuard — AI Agent Development Rules & Vision

## Project Vision
FocusGuard is a browser extension that interrupts distraction before it becomes doomscrolling. It is not meant to fully block websites, but rather let the user use social platforms normally for real tasks while stopping the endless recommendation loop of feeds, Shorts, Reels, and similar content.

Everything should feel local, lightweight, fast, and aesthetically premium.

## Core Product Principles
1. **Smart Goal Flow**: If the user has a goal, remind them. If they want to chill, let them, but track the session.
2. **Intentional Overrides**: Require conscious effort (like CAPTCHAs) to bypass blocks for breaks.
3. **No Heavy Blocking**: Overlay injection rather than hard redirects.
4. **Premium Aesthetics**: Dark glassmorphism, vibrant gradients, micro-animations.

## Architecture Overview
- **Manifest V3**: Modern extension architecture.
- **Background Service Worker**: Manages session state, goal inference, and message routing.
- **Content Scripts**: Injected into target sites (YouTube, Instagram). Uses Shadow DOM for isolation to render distraction-blocking overlays.
- **Popup**: Manages the user's daily goals, todo list, and break timers.
- **Settings**: Full-page configuration for platform-specific rules and advanced features.

## Browser Compatibility Requirements
- Target: Chrome, Firefox (128+ MV3 support), Brave, Edge.
- Must use the cross-browser namespace pattern: `const api = (typeof browser !== 'undefined') ? browser : chrome;`
- Avoid Chrome-exclusive APIs where standard web APIs or cross-compatible extension APIs exist.

## Performance Requirements
- **Minimal Background Activity**: The service worker should wake up only on specific events.
- **Event-Driven**: Rely on `chrome.runtime.onMessage`, `chrome.tabs.onUpdated`, and `chrome.alarms` rather than polling.
- **Fast Injection**: Content scripts should classify URLs and inject overlays almost instantly.
- **Low Memory Footprint**: No heavy frameworks (React, Vue, etc.). Vanilla JS, HTML, CSS only.

## Coding Conventions
- **Vanilla Tech Stack**: Plain JavaScript, HTML, and CSS. No build tools or bundlers required for the core logic.
- **Modularity**: Use ES modules (`type: module`) in the background, popup, and settings. Content scripts must remain plain scripts (IIFEs) due to injection constraints.
- **Styling**: Premium dark glassmorphism. Use the predefined design system colors and animations.

## Known Limitations
- **SPA Navigation**: Modern sites like YouTube and Instagram are Single Page Applications. `webNavigation` API sometimes misses internal state changes, requiring a MutationObserver/popstate fallback in content scripts.

## Important Implementation Decisions
- **Privacy First**: No `history` permission is used. Goal inference relies on a short-lived rolling buffer of recent tabs using `tabs.onUpdated`.
- **Shadow DOM**: Overlays are isolated in Shadow DOM to prevent host-site CSS interference.

## Development Workflow
1. Read AGENTS.md, PROJECT_STATE.md, ARCHITECTURE.md, and DECISIONS.md before starting new features.
2. Check previous architectural decisions in DECISIONS.md.
3. Update these 4 memory files whenever significant changes or decisions are made.
