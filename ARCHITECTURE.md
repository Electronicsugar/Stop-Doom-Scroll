# Technical Architecture

## Folder Structure
```text
/
├── manifest.json         # Extension configuration (MV3)
├── AGENTS.md             # AI Agent rules & vision
├── PROJECT_STATE.md      # Current task & bug tracking
├── ARCHITECTURE.md       # Architecture documentation
├── DECISIONS.md          # Architecture Decision Records
├── background/
│   └── background.js     # Service worker (state, routing, alarms)
├── content/
│   ├── content-common.js # Shared UI & logic (Shadow DOM overlay, SPA routing)
│   ├── content-youtube.js# Site-specific URL classification
│   ├── content-instagram.js# Site-specific URL classification
│   └── overlay.css       # Basic host styles for overlay
├── lib/
│   ├── constants.js      # Message types, configs, defaults
│   └── storage.js        # Abstraction over chrome.storage.local
├── popup/
│   ├── popup.html        # Extension popup markup
│   ├── popup.css         # Popup styles (dark glassmorphism)
│   └── popup.js          # Popup logic (goals, tasks, break timers)
├── settings/
│   ├── settings.html     # Settings page markup
│   ├── settings.css      # Settings styles
│   └── settings.js       # Settings logic
└── icons/                # Extension icon assets
```

## Data Flow
1. **User Action**: User interacts with Popup or navigates to a distracting URL.
2. **Content Script**: Detects URL change, classifies it, sends `CHECK_DISTRACTION` to Background.
3. **Background Worker**: Evaluates current state (Is break active? Is it a blocked page type? Is chill mode active?), sends response back to Content Script.
4. **Content Script**: Depending on response, either injects the Shadow DOM overlay or removes it.
5. **Popup/Settings**: Read from and write to `chrome.storage.local` via the Background worker to ensure centralized state consistency.

## Extension Lifecycle
- `chrome.runtime.onInstalled`: Initializes default settings and clears any stale session data.
- `chrome.runtime.onStartup`: Clears the current session to enforce daily/session-based goal setting.
- `chrome.alarms`: Used to trigger break expiration events in the background, which then broadcast to active tabs to re-evaluate distraction rules.

## State Management Strategy
- Centralized in `background.js` for fast, synchronous decision making.
- Periodically persisted to `chrome.storage.local` using the helper functions in `lib/storage.js`.

## Storage Strategy
Using `chrome.storage.local` exclusively (no `chrome.storage.sync` to prevent quota issues and ensure fast local access).
Keys used:
- `session`: Current active session state (goals, break times, chill mode).
- `todos`: Array of user tasks.
- `settings`: User preferences.
- `urlHistory`: Short-lived rolling buffer for goal inference.

## Browser Compatibility Notes
- Target is Manifest V3.
- All APIs are accessed via a wrapper `const api = (typeof browser !== 'undefined') ? browser : chrome;` to support Firefox's `browser` namespace alongside Chrome/Edge's `chrome` namespace.

## Site-Specific Detection Strategies
Because modern sites are Single Page Applications (SPAs):
1. **Content Common**: Uses a `MutationObserver` and `popstate` event listeners as fallbacks to detect URL changes without full page reloads.
2. **Site Scripts**: Use Regex patterns to classify the current URL (e.g., `^https?://(www\.)?youtube\.com/shorts/.+` for Shorts).
