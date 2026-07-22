# Changelog

## Unreleased

## v1.2.0 — 2026-07-23

### Added
- Break mode support for Universal Blocker websites during active breaks
- Fast-path session state caching in Universal Blocker to eliminate block screen flash during breaks
- Broadcast listeners for `UNBLOCK_PAGE` and `BREAK_ENDED` in Universal Blocker
- Custom `.agents/skills` for version control and commit workflows

### Changed
- Redesigned Universal Blocker overlay to match original Sage aesthetic (SAGE branding, leaf icon, Playfair Display heading, compact translucent glass card)
- Made Matched rule badge pill-shaped and smaller
- Styled `← Go Back` button as a compact, centered primary pill button
- Restored rich translucent glass backdrop and backdrop blur on Universal Blocker overlay
- Streamlined Settings Lock UI by removing Manage button, change password dialog, and unlock delay options

### Fixed
- Break CTA banner in popup is now completely hidden when Enable Break Button is turned off in settings
- Fixed multi-millisecond block screen flash on Universal Blocker sites when a break is active
- Daily focus time automatically resets to 0 at midnight

### Removed
- Temporarily Allow button from Universal Blocker screen overlay
- Temporarily Allow (10 min) and Whitelist Website buttons from platform content scripts
- Manage Lock button and obsolete modal dialogs from Settings
- Star emoji from empty task list state

## v1.1.0 — 2026-07-20
### Added
- Universal website blocker with custom URL rules
- Settings lock with password protection
- Focus session timer with play/pause/stop controls
- Daily focus streak tracking
- Theme system (light/dark/auto)
- Break system with configurable duration and daily limits
- Goal inference and chill mode
