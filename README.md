# Fav Launcher

**Bookmark files, folders, commands, macros, and workspaces — with groups, notes, drag & drop, and team sharing.**

Fav Launcher gives you a persistent Favorites panel in VS Code where you can pin anything you open or run repeatedly. No more hunting through menus or re-typing commands.

---

## Getting Started

1. Open the **Favorites** panel — click the ⭐ icon in the Activity Bar, or press `Ctrl+Shift+F`
2. Click **Add File or Folder** (📄 button) to add the current editor file, or pick any file/folder from the system dialog
3. Right-click anything in the Explorer or an editor tab → **Add to Favorites**
4. Use the panel to open, run, or organize everything you've saved

---

## Panel Overview

The Favorites panel lives in:
- The **Activity Bar** (left sidebar ⭐ icon) — always visible
- The **bottom Panel** tab — toggle with `Ctrl+Shift+F`

The **status bar** shows `⭐ Fav (12)` with a live count. Hover it for a full breakdown. A `⚠` appears when any favorited files are missing.

---

## Adding Items

| Action | How |
|---|---|
| Add current file | Click 📄 in panel toolbar |
| Add any file or folder | Click 📄 → system file picker dialog |
| Add from Explorer sidebar | Right-click file/folder → **Add to Favorites** |
| Add from editor tab | Right-click tab → **Add to Favorites** |
| Add a VS Code command | Click ➕ in panel toolbar → pick from curated list or type a command ID |
| Add a macro | Panel `···` → **Add Macro** — sequence of VS Code commands + terminal commands |
| Add a group (folder) | Panel `···` → **Add Group** |
| Add a separator | Panel `···` → **Add Separator** — visual divider with optional label |
| Add a workspace | Panel `···` → **Add Workspace / Folder** — opens in a new window when clicked |
| Add from clipboard | Panel `···` → **Add from Clipboard** — auto-detects file path vs command ID |

---

## Organizing

### Groups
- Create a group with **Add Group**, then drag items into it
- Each group shows a count badge: `(3)`
- Right-click a group → **Open All Files in Group** or **Close All Editors in Group**
- Groups can be nested — drag a group into another group

### Pinning
- Right-click any item → **Pin** — pinned items always appear at the top
- Pinned items launch via `Ctrl+Alt+1` through `Ctrl+Alt+9` (first 9 pinned items in order)

### Drag & Drop
- Drag items to reorder them manually
- Drag into a group to move them
- Drag out of a group to move to root

### Renaming
- Right-click any item or group → **Rename**

### Separators with Labels
- Right-click a separator → **Edit Separator Label** to give it a title like `── Work ──`

---

## Running Items

| Type | What happens when clicked |
|---|---|
| **File** | Opens in the editor |
| **Folder** | Reveals in the Explorer sidebar |
| **Command** | Executes the VS Code command |
| **Macro** | Runs each step in sequence |
| **Workspace** | Opens the folder/workspace in a new VS Code window |

### Macros
Each macro step is either:
- A **VS Code command** — runs any registered command
- A **Terminal command** — sends text to the integrated terminal

Edit macro steps: right-click a macro → **Edit Macro Steps**

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+F` | Open / focus Favorites panel |
| `Ctrl+Shift+F` (panel focused) | Filter favorites inline |
| `Ctrl+Alt+1` – `Ctrl+Alt+9` | Launch pinned item #1–9 |
| `Ctrl+Alt+R` | Reveal current file in the Favorites panel |
| `Ctrl+Alt+G` | Jump to group (quick pick) |

---

## Filtering & Search

- Press `Ctrl+Shift+F` while the panel is focused, or click the 🔍 button in the toolbar
- Type to filter — matches label, path, command ID, and note
- **Group names are searchable** — if a group name matches, all its children are shown
- Clear the filter from the toolbar or press Escape

---

## Sorting

Panel `···` → **Set Sort Order**:

| Mode | Behavior |
|---|---|
| **Manual** (default) | Drag & drop order |
| **Alphabetical** | A–Z by label |
| **By type** | Files, commands, macros grouped together |
| **Last used** | Most recently opened/run first |

Pinned items always appear first regardless of sort order.

---

## Recent Section

Enable in settings (`favLauncher.showRecentSection: true`) or via Panel `···` → **Toggle Recent Section**.

Shows the 5 most recently used items at the very top of the panel as a virtual "Recent" group.

---

## Customization

### Icons
Right-click any item or group → **Set Icon** — pick from common codicons or type any [codicon name](https://microsoft.github.io/vscode-codicons/dist/codicon.html).

### Colors
Right-click any item or group → **Set Color Label** — tints the item's icon:

🔴 Red · 🟠 Orange · 🟡 Yellow · 🟢 Green · 🔵 Blue · 🟣 Purple

### Notes
Right-click any item → **Add / Edit Note** — attach a short reminder. Notes appear inline, in the tooltip, or both — configurable in settings.

### Compact Mode
Settings → `favLauncher.compactMode: true` — hides description text for a denser list.

---

## File & Git Info in Tooltips

Hover over any item to see a rich hover card:
- **File size** and **last modified** date
- **Git status** (Modified, Added, Deleted, etc.) — updates every 30 seconds
- **Unsaved changes** indicator (`●` in description, highlighted in hover card)
- Note, last-used time, pinned status, macro steps

---

## Copy Path

Right-click a file or folder favorite:
- **Copy Path** — absolute path to clipboard
- **Copy Relative Path** — relative to workspace root

---

## Storage Scopes

Switch scope from the panel toolbar or `···` menu:

| Scope | Where stored | Use when |
|---|---|---|
| **Workspace** (default) | VS Code `workspaceState` | Per-project favorites |
| **Global** | VS Code `globalState` | Same favorites in every project |
| **Team** | `.vscode/favorites.json` | Commit to Git to share with your team |

### Team Favorites
When **Team** scope is active, all changes write to `.vscode/favorites.json` in your workspace root. Add that file to Git and push — everyone who clones the repo gets the same favorites automatically.

---

## Import & Export

- **Export** — Panel `···` → **Export to JSON** — saves a `.json` backup
- **Import** — Panel `···` → **Import from JSON** — shows a diff preview (new vs duplicates) before merging

Export also resets the **backup reminder** timer (configurable via `favLauncher.backupReminderDays`).

---

## Run on Startup

Right-click any file, command, or macro → **Set as Startup Item**.

That item will automatically open or run every time this workspace loads. Right-click again to toggle it off. Stored per-workspace.

---

## Cleanup Commands

| Command | Action |
|---|---|
| **Remove Dead Links** | Finds file favorites whose paths no longer exist and removes them after confirmation |
| **Remove Duplicates** | Finds exact duplicate file paths or command IDs and removes the extras |

Both are in the Panel `···` menu.

---

## Reset Options

| Command | What it does |
|---|---|
| Right-click → **Reset Icon & Color** | Clears custom icon and color on one item |
| Panel `···` → **Reset All Icons & Colors** | Clears all custom styling on every item |
| Panel `···` → **Reset All Settings to Defaults** | Resets all `favLauncher.*` settings |

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `favLauncher.storageScope` | `workspace` | Where to store favorites: `workspace`, `global`, or `team` |
| `favLauncher.sortOrder` | `manual` | Sort order: `manual`, `alpha`, `type`, `lastUsed` |
| `favLauncher.noteDisplay` | `both` | Where notes appear: `both`, `inline`, `tooltip` |
| `favLauncher.itemDescription` | `both` | Secondary description: `both`, `path`, `note`, `none` |
| `favLauncher.compactMode` | `false` | Hide descriptions for a denser list |
| `favLauncher.autoRevealCurrentFile` | `false` | Auto-highlight the current editor file in the panel |
| `favLauncher.showRecentSection` | `false` | Show a "Recent" group with the last 5 used items |
| `favLauncher.startupItemId` | `""` | ID of favorite to open/run on workspace startup |
| `favLauncher.backupReminderDays` | `0` | Days between export reminders (0 = off) |

---

## Commands (Command Palette)

Search `Favorites:` in the Command Palette (`Ctrl+Shift+P`) to see all commands:

- `Favorites: Open`
- `Favorites: Add Current File`  
- `Favorites: Add Command`
- `Favorites: Filter`
- `Favorites: Reveal Current File`
- `Favorites: Set Sort Order`
- `Favorites: Export to JSON`
- `Favorites: Import from JSON`
- `Favorites: Remove Dead Links`
- `Favorites: Remove Duplicates`
- `Favorites: Toggle Recent Section`
- `Favorites: Reset All Icons & Colors`
- `Favorites: Reset All Settings to Defaults`
- `Favorites: Settings`
- `Favorites: Launch Pinned #1` – `#9`
- `Favorites: Jump to Group`

---

## Tips

- **Drag the panel** to the Secondary Side Bar (right side) if you prefer it there
- **Team favorites** are great for onboarding — commit `.vscode/favorites.json` with links to key files, run configs, and docs
- **Macros** can combine opening a file, running a build command, and launching a terminal command in one click
- **Pinned + `Ctrl+Alt+1`** gives you instant one-key access to your most-used file or command
