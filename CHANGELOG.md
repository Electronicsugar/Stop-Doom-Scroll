# Changelog

## Unreleased
### Added
- **Logo & Branding**: Redesigned official SAGE extension logo (Shield of Clarity aesthetic). Generated and tightly cropped icon set (`16x16`, `32x32`, `48x48`, `128x128`).
- **UI Integration**: Added compact logo icon branding to popup header and settings header.

## v1.2.1 — 2026-07-23
### Fixed
- **Settings Lock**: Fixed password clearing on toggle off, ensuring full password reset upon disabling lock settings.
- **Settings Lock**: Fixed pending change execution so protected toggles update immediately after entering password.
- **Content Scripts**: Standardized DOM hiding & element restoration helpers across YouTube and Instagram content scripts.

## v1.2.0 — 2026-07-23
- **Universal Blocker**: Redesigned overlay to match Sage glass aesthetic, unblocks during breaks, removed temp allow button, eliminated screen flash.
- **Settings Lock**: Streamlined flow with direct password prompt and instant unlock.
- **Popup & Focus**: Hide break CTA banner when break button disabled; daily focus time resets at midnight.
- **Agent Workflows**: Added `.agents` skill definitions for version control and commits.

## v1.1.0 — 2026-07-20
- Universal website blocker with custom URL rules.
- Settings lock with password protection.
- Focus session timer, streak tracking, theme selector, and break system.
