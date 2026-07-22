```yaml
name: version_control
description: Track unreleased changes and manage semantic versioning for Sage
trigger: always_on
```

# Version Control

Maintain a persistent release history for Sage. Every modification must be recorded as an unreleased change in `CHANGELOG.md`.

## Rules

1. **Record Every Change**: After any code modification, append a one-line summary under the `## Unreleased` section of `CHANGELOG.md`. Categorise as `Added`, `Changed`, `Fixed`, or `Removed`.

2. **Version Source of Truth**: The canonical version lives in `manifest.json` → `"version"`. All other references (docs, footers) must match it.

3. **Versioning Scheme**: `MAJOR.MINOR.PATCH`
   - **Patch** (`x.y.Z`): Bug fixes, style tweaks, copy changes, small UX adjustments.
   - **Minor** (`x.Y.0`): New features, new settings, new UI sections, behaviour changes.
   - **Major** (`X.0.0`): Breaking changes, architecture rewrites. Only bump manually.

4. **Release Flow** (triggered by the `commit` skill):
   - Evaluate all unreleased changes.
   - Determine patch or minor increment.
   - Update `manifest.json` version.
   - Move unreleased items under a new `## vX.Y.Z — YYYY-MM-DD` heading.
   - Never overwrite previous release entries.

## CHANGELOG.md Format

```markdown
# Changelog

## Unreleased
### Added
- ...
### Changed
- ...
### Fixed
- ...
### Removed
- ...

## v1.1.0 — 2026-07-20
### Added
- Initial universal website blocker
- Settings lock with password protection
```
