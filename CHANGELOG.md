# Changelog

All notable changes to **Fav Launcher** are documented here.

## [0.0.5] — 2026-02-26

### Fixed
- Separator rename now correctly updates the visible label (was updating internal `label` field instead of `separatorLabel`)
- File favorites on remote connections (SSH, WSL, Dev Containers) no longer show false "⚠ missing" warning — path existence checks are skipped when running remotely
- Dead link count in status bar no longer shows false positives on remote connections

## [0.0.4] — 2026-02-26

### Fixed
- Changelog versions corrected to match published releases

## [0.0.3] — 2026-02-26

### Fixed
- Screenshot image paths updated to absolute GitHub URLs so they display correctly on the marketplace listing

## [0.0.2] — 2026-02-26

### Added
- Screenshots added to marketplace listing (panel, context menu, panel menu, tooltip)
- Panel title now shows active scope — e.g. **Favorites — Workspace**, **Favorites — Global**, **Favorites — Team**

### Fixed
- Import: smart duplicate detection by file path, command ID, and label+type (not just ID)
- Import: **Merge** option now correctly skips duplicates and only adds missing items
- Import: fresh IDs assigned to all imported items to prevent conflicts
- Import: empty list loads directly without prompting
- Export: default filename now includes scope (e.g. `favorites-workspace.json`)
- Export: success message confirms scope and item count
- All destructive commands (Delete All, Reset All Icons, Reset All Settings, Reset Icon & Color) now show a modal confirmation dialog with detail text

### Added
- **Delete All Favorites** command — removes all items in the current scope with confirmation
- Bottom menu reordered: Reset All Icons & Colors → Reset All Settings → Help → Settings

## [0.0.1] — 2026-02-25

### Added

**Core favorites management**
- Add files and folders via panel button, Explorer right-click, editor tab right-click, or `Ctrl+Alt+A`
- Add VS Code commands from a curated list or by typing a command ID
- Add macros — sequences of VS Code commands and/or terminal commands
- Add workspace switcher items — open a folder or `.code-workspace` in a new window
- Add separators with optional labels (e.g. `── Work ──`)
- Add groups (folders) to organize items
- Add from clipboard — auto-detects file path vs command ID

**Organization**
- Drag & drop reordering within and between groups
- Nested groups (groups inside groups)
- Pin items — always appear at the top regardless of sort order
- Rename any item or group
- Duplicate items
- Move items between groups
- Sort by: manual, alphabetical, by type, or last used

**Launching**
- Single click opens files (focuses existing tab instead of duplicating)
- `Ctrl+Alt+1` – `Ctrl+Alt+9` quick-launch for top 9 pinned items
- `Ctrl+Alt+R` to reveal current file in the panel
- `Ctrl+Alt+G` to jump to a group via quick pick
- Run on startup — designate one item to open/run automatically when the workspace loads

**Customization**
- Custom icons per item or group (any codicon name)
- Color labels — tints the item icon (red, orange, yellow, green, blue, purple)
- Notes — attach a memo to any item (inline, tooltip, or both)
- Compact mode — hide descriptions for a denser list
- Auto-reveal current file in the panel when switching editors

**Macros**
- Steps can be VS Code commands or terminal commands
- Edit macro steps one-by-one via quick pick
- Edit Macro as JSON — edit all steps at once in the editor

**Storage & sharing**
- Workspace scope (default) — per-project
- Global scope — shared across all workspaces
- Team scope — stored in `.vscode/favorites.json`, commit to share with your team

**Import / Export**
- Export to JSON with scope-aware filename and backup reminder
- Import from JSON — merge or replace

**UI**
- Rich markdown hover cards with file size, git status, unsaved changes, macro steps, notes
- Git status badges on file items updated every 30 seconds
- Status bar `⭐ Fav` button with live count and breakdown tooltip
- Onboarding placeholder with right-click menu when list is empty
- Help button opens README in Markdown preview
- Remote-compatible — runs on local machine even in SSH/WSL/Dev Container sessions
