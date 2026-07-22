```yaml
name: commit
description: Update docs, bump version, and commit all changes
```

# Commit

Update documentation, release unreleased changes, and commit with a clear message.

## Steps

1. **Update Memory Files**: Review all recent code changes and update these files if they have become stale:
   - `PROJECT_STATE.md` — current feature status and known issues.
   - `DECISIONS.md` — any new architectural decisions made.
   - `ARCHITECTURE.md` — if structure or data flow changed.

2. **Release Version** (using the `version_control` skill):
   - Read `CHANGELOG.md` unreleased section.
   - If there are unreleased changes, determine patch vs minor increment.
   - Update `manifest.json` version.
   - Move unreleased items into a dated release heading in `CHANGELOG.md`.

3. **Stage & Commit**:
   - Run `git add -A`.
   - Compose a commit message summarising the changes. Use the format:
     ```
     v{version}: {short summary}

     - bullet points of key changes
     ```
   - Run `git commit -m "{message}"`.

4. **Do NOT push**. Leave that to the user.
