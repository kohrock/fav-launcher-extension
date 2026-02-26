# Changelog

All notable changes to **Fav Launcher** are documented here.

## [1.0.0] — 2026-02-26

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
- Edit Macro as JSON — edit all steps at once in the editor with full JSON support

**Storage & sharing**
- Workspace scope (default) — per-project
- Global scope — shared across all workspaces
- Team scope — stored in `.vscode/favorites.json`, commit to share with your team
- Live file watcher for team favorites file

**Import / Export**
- Export to JSON with backup reminder (configurable interval)
- Import from JSON with diff preview (new vs. duplicates) before merging or replacing

**Filtering & search**
- Inline filter — type to filter by label, path, command ID, note, or group name
- Recent section — shows last 5 used items at the top (optional)

**Cleanup**
- Remove dead links — scan and bulk-remove missing file favorites
- Remove duplicates — find and remove exact duplicate items

**UI polish**
- Rich markdown hover cards — file size, last modified, git status, unsaved-change indicator, macro steps, args, note, last-used time
- Git status badges on file items (`[M]`, `[A]`, `[D]` etc.) updated every 30 seconds
- Unsaved-change indicator (`●`) on file items with open dirty editors
- Group badge counts showing number of items in each group
- Status bar `⭐ Fav` button with live count and breakdown tooltip
- Dead link warning badge (`⚠`) on status bar
- Onboarding placeholder when the list is empty
- Collapse all groups button in toolbar
- Help button (`?`) opens the full README in Markdown preview

**Context menus**
- Right-click Explorer items → Add to Favorites
- Right-click editor tabs → Add to Favorites
- Full right-click menu on every item: pin, open, open to side, rename, move, duplicate, set icon, set color, edit note, edit macro, copy path, copy relative path, set startup item, remove

**Settings** (`favLauncher.*`)
- `storageScope` — workspace / global / team
- `sortOrder` — manual / alpha / type / lastUsed
- `noteDisplay` — both / inline / tooltip
- `itemDescription` — both / path / note / none
- `compactMode` — hide descriptions
- `autoRevealCurrentFile` — auto-highlight current file
- `showRecentSection` — show Recent group at top
- `startupItemId` — item to open/run on workspace load
- `backupReminderDays` — export reminder interval

**Reset options**
- Reset icon & color on individual items
- Reset all icons & colors
- Reset all settings to defaults
