# Fav Launcher

**Bookmark files, folders, commands, macros, and workspaces — with groups, notes, drag & drop, and team sharing.**

Fav Launcher gives you a persistent Favorites panel in VS Code / Cursor where you can pin anything you open or run repeatedly. No more hunting through menus or re-typing commands.

![Favorites panel showing files, groups, commands and macros](https://raw.githubusercontent.com/kohrock/fav-launcher-extension/main/media/screenshot-panel.png)

---

## Getting Started

1. Open the **Favorites** panel — click the ⭐ icon in the Activity Bar, or press `Ctrl+Shift+F`
2. Click the **Add File or Folder** button (📄) in the toolbar, or pick any file/folder from a system dialog
3. Right-click any file in the Explorer or an editor tab → **Add to Favorites**
4. Use the panel to open, run, or organize everything you've saved

---

## Panel Overview

The **Favorites** sidebar (⭐ in the Activity Bar) contains **three separate views**:

- **Global Favorites** — stored in VS Code `globalState` (same list in every project)
- **Workspace Favorites** — stored in VS Code `workspaceState` (per-project)
- **Team Favorites** — stored in `.vscode/favorites.json` (commit to Git to share)

Each view has its own list. You can hide or reorder the views via the sidebar (right-click the view title or use the view container menu). The **status bar** shows `⭐ Fav (12)` with the total count across all three; hover for a breakdown. A `⚠` appears when any favorited files are missing from disk.

---

## Adding Items

| Action | How |
|---|---|
| Add current file | Click 📄 in panel toolbar |
| Add any file or folder | Click 📄 → system file picker dialog |
| Add from Explorer sidebar | Right-click file/folder → **Add to Favorites** (`Ctrl+Alt+A`) |
| Add from editor tab | Right-click tab → **Add to Favorites** |
| Add a VS Code command | Click ➕ in panel toolbar → pick from list or type a command ID |
| Add a macro | Panel `···` → **Add Macro** |
| Add a group | Panel `···` → **Add Group** |
| Add a separator | Panel `···` → **Add Separator** — visual divider with optional label |
| Add a workspace/folder | Panel `···` → **Add Workspace File or Folder** — opens in a new window when clicked |
| Add from clipboard | Panel `···` → **Add from Clipboard** — auto-detects file path vs command ID |
| Add AI Prompt | Click the prompt icon in the toolbar or Panel `···` → **Add AI Prompt** — reusable prompt templates for Codex/Cursor chat (see [AI Prompts](#ai-prompts)) |

---

![Right-click context menu on a favorite item](https://raw.githubusercontent.com/kohrock/fav-launcher-extension/main/media/screenshot-context-menu.png)

## Organizing

### Groups
- Create a group with **Add Group**, then drag items into it
- Each group shows a count badge: `(3)`
- Right-click a group → **Open All Files in Group** or **Close All Editors in Group**
- Groups can be nested

### Pinning
- Right-click any item → **Pin** — pinned items always appear at the top
- Pinned items launch via `Ctrl+Alt+1` through `Ctrl+Alt+9`

### Drag & Drop
- Drag items to reorder manually
- Drag into a group to move them inside
- Drag out of a group to move to root

### Move and copy between lists
- Right-click any item or group → **Favorites: Move to…** or **Favorites: Copy to…** to move or copy it to another list (Global, Workspace, or Team). You choose the target list and, if the target has groups, which group to add it to.

### Renaming
- Right-click any item or group → **Rename**

### Separators
- Right-click a separator → **Edit Separator Label** to give it a title like `── Work ──`
- Right-click → **Edit Separator Label** again → choose **Remove label** to clear it

---

## Running Items

| Type | What happens when clicked |
|---|---|
| **File** | Opens in the editor — focuses the existing tab if already open |
| **Folder (in workspace)** | Reveals in Explorer sidebar |
| **Folder (outside workspace)** | Prompts to open in a new window or add to workspace |
| **Command** | Executes the VS Code command |
| **Macro** | Runs each step in sequence |
| **Workspace** | Opens the folder or `.code-workspace` file in a new window |
| **AI Prompt** | Resolves the template (with `${selection}`, `${file}`, etc.), then sends to Codex, Cursor, or clipboard — see [AI Prompts](#ai-prompts) |

### Macros
Each macro step is either:
- A **VS Code command** — runs any registered command
- A **Terminal command** — sends text to the integrated terminal

Edit macro steps: right-click a macro → **Edit Macro Steps**  
Edit the entire macro as raw JSON: right-click → **Edit Macro as JSON** — opens in the editor, save to apply

---

## AI Prompts

**AI Prompt** favorites are reusable prompt templates you can run to send resolved text to **Codex**, **Cursor**, or the clipboard. Handy for “explain this”, “refactor this”, code review, or any template you use often in chat.

### Add an AI Prompt

- Click the prompt icon in a Favorites view toolbar, or Panel `···` → **Add AI Prompt**
- Pick a starter template (see **Templates** below) or start from scratch
- Edit the template: use tokens like `${selection}`, `${file}`, `${relativePath}`, `${workspaceFolder}`, `${clipboard}`, and `${input:Label}` (prompts you for a value). You can combine them with your own text.
- Choose where to send the resolved prompt: **Auto** (detects Codex or Cursor), **Codex**, **Cursor**, or **Clipboard**

### Templates

When you add an AI Prompt, you can start from one of these templates:

| Template | Purpose |
|---|---|
| **Blank Prompt** | Empty template with commented examples of all tokens. Use this to build a custom prompt from scratch. |
| **Explain Selection** | Asks what you want explained, then sends the selected code plus file/workspace context. Good for “explain this code” or “how does this work?” |
| **Planning Prompt** | Planning-only: asks for a plan title and change request, then requests a markdown implementation plan (checklist, decisions with pros/cons, scope, risks). Instructs the AI to write the plan to a file and summarize in chat. |
| **Review Selection** | Code review: you specify the review goal; the prompt sends the selection and asks for assessment, bugs, maintainability, performance, and improvements. |
| **Debug Issue** | You describe the problem or symptom; the prompt sends the selection and context and asks for likely causes, what to inspect, debugging steps, and assumptions. |

### Run a prompt

- Click the prompt favorite in the list, or right-click → **Favorites: Run Prompt**
- If the template has `${input:...}` tokens, you’ll be asked for values
- The resolved prompt is sent to the chosen destination (and optionally pasted into chat)

### Settings

| Setting | Default | Description |
|---|---|---|
| `favLauncher.ai.defaultTarget` | `auto` | Default destination: `auto` (detect Codex/Cursor), `codex`, `cursor`, or `clipboard` |
| `favLauncher.ai.autoPaste` | `true` | When running a prompt, paste the resolved text into the chat input after opening |

Right-click a prompt favorite → **Favorites: Edit Prompt** or **Edit Prompt as JSON** to change the template or destination.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+F` | Open / focus Favorites panel |
| `Ctrl+Shift+F` (panel focused) | Filter favorites inline |
| `Ctrl+Alt+1` – `Ctrl+Alt+9` | Launch pinned item #1–9 |
| `Ctrl+Alt+R` | Reveal current file in Favorites panel |
| `Ctrl+Alt+G` | Jump to group (quick pick) |
| `Ctrl+Alt+A` | Add selected file/folder to Favorites |

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

Shows the 5 most recently used items at the top of the panel as a virtual "Recent" group.

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

![Panel menu showing all available actions](https://raw.githubusercontent.com/kohrock/fav-launcher-extension/main/media/screenshot-panel-menu.png)

## File & Git Info in Tooltips

![Rich tooltip hover card with file info and git status](https://raw.githubusercontent.com/kohrock/fav-launcher-extension/main/media/screenshot-tooltip.png)

Hover over any item to see a rich hover card:
- **File size** and **last modified** date
- **Git status** (Modified, Added, Deleted, etc.) — live from the built-in Git extension
- **Unsaved changes** indicator (`●` in the label, highlighted in the hover card)
- Note, last-used time, pinned status, macro steps, and args

---

## Copy Path

Right-click a file or folder favorite:
- **Copy Path** — absolute path to clipboard
- **Copy Relative Path** — relative to workspace root

---

## Storage Scopes

Each of the three sidebar views is tied to a fixed scope:

| View | Where stored | Use when |
|---|---|---|
| **Global Favorites** | VS Code `globalState` | Same favorites in every project |
| **Workspace Favorites** | VS Code `workspaceState` | Per-project favorites |
| **Team Favorites** | `.vscode/favorites.json` | Commit to Git to share with your team |

**Where new favorites are saved**

- **Add from a Favorites view** (toolbar buttons or welcome links in Global / Workspace / Team): the new item is added to **that view’s list**.
- **Add from Explorer** (right‑click file → **Add to Favorites**) or from the Command Palette: the new item is added to the list set in **Fav Launcher › Default Add Scope** (default: **Workspace**). Change that setting to make “Add to Favorites” use Global or Team by default.

### Multi-root workspaces

If you have more than one folder in the workspace, **Team Favorites** uses one folder’s `.vscode/favorites.json`. By default it uses the **first** folder. To use a different folder, set **Fav Launcher › Team Workspace Folder** to a 0-based index (e.g. `0` or `1`) or the workspace folder name. The Team view and “add to Team” both use this folder.

### Team Favorites
When **Team** scope is active, all changes write to `.vscode/favorites.json` in your workspace root. Commit and push that file — everyone who clones the repo gets the same favorites automatically.

---

## Import & Export

### Export
Panel `···` → **Export to JSON**

- Exports the list chosen by **Fav Launcher › Default Add Scope** (default: Workspace). Use the setting to control which list is exported when you run the command.
- The default filename reflects the scope — e.g. `favorites-workspace.json`, `favorites-global.json`
- The success message confirms which scope was exported and how many items
- Resets the **backup reminder** timer (see `favLauncher.backupReminderDays`)

### Import
Panel `···` → **Import from JSON**

Pick a previously exported `.json` file. If your list is currently empty, items load immediately with no questions asked. If you already have items, you choose:

| Option | What it does |
|---|---|
| **Merge** | Adds only items that don't already exist — skips duplicates automatically |
| **Replace all** | Clears your current list and loads everything from the file |

Duplicate detection is by content — same file path, same command ID, or same label + type. All imported items get fresh IDs so there are never conflicts, regardless of which machine the file came from.

---

## Run on Startup

Right-click any file, command, or macro → **Set as Startup Item**.

That item will automatically open or run every time this workspace loads. Right-click again to toggle it off.

---

## Cleanup Commands

| Command | Action |
|---|---|
| **Remove Dead Links** | Finds file favorites whose paths no longer exist and removes them after confirmation |
| **Remove Duplicates** | Finds exact duplicate file paths or command IDs and removes the extras |

Both are in the Panel `···` menu.

---

## Reset & Delete Options

All destructive actions show a **modal confirmation dialog** with detail before doing anything.

| Command | What it does |
|---|---|
| Right-click item → **Reset Icon & Color** | Clears custom icon and color on one item |
| Panel `···` → **Reset All Icons & Colors** | Clears all custom styling on every item |
| Panel `···` → **Reset All Settings to Defaults** | Resets all `favLauncher.*` settings (favorites are not affected) |
| Panel `···` → **Delete All Favorites** | Permanently removes all favorites in the chosen list (run from a view’s toolbar for that list, or from the palette to use the default list) |

---

## Remote & Multi-Machine

Fav Launcher is marked `extensionKind: ["ui"]` — it always runs on the **local machine**, even when connected to a remote via SSH, WSL, or Dev Containers. This ensures:
- File dialogs, settings, and UI commands always work
- No "command not found" errors on the remote side
- You can install the extension **locally** or **on the remote** independently

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `favLauncher.defaultAddScope` | `workspace` | When adding from Explorer or the Command Palette (no view), which list to add to: `global`, `workspace`, or `team` |
| `favLauncher.teamWorkspaceFolder` | `0` | In a multi-root workspace, which folder’s Team Favorites file to use: 0-based index (e.g. `0`, `1`) or workspace folder name |
| `favLauncher.sortOrder` | `manual` | Sort order: `manual`, `alpha`, `type`, `lastUsed` |
| `favLauncher.noteDisplay` | `both` | Where notes appear: `both`, `inline`, `tooltip` |
| `favLauncher.itemDescription` | `both` | Secondary description: `both`, `path`, `note`, `none` |
| `favLauncher.compactMode` | `false` | Hide descriptions for a denser list |
| `favLauncher.autoRevealCurrentFile` | `false` | Auto-highlight the current editor file in the panel |
| `favLauncher.showRecentSection` | `false` | Show a "Recent" group with the last 5 used items |
| `favLauncher.startupItemId` | `""` | ID of the favorite to open/run on workspace startup |
| `favLauncher.backupReminderDays` | `0` | Days between export reminders (0 = off) |
| `favLauncher.ai.defaultTarget` | `auto` | Default destination for AI prompt favorites: `auto`, `codex`, `cursor`, or `clipboard` |
| `favLauncher.ai.autoPaste` | `true` | When running a prompt favorite, paste the resolved prompt into chat after opening |

---

## Commands (Command Palette)

Search `Favorites:` in the Command Palette (`Ctrl+Shift+P`):

- `Favorites: Open`
- `Favorites: Add Current File`
- `Favorites: Add Command`
- `Favorites: Add Macro`
- `Favorites: Add AI Prompt`
- `Favorites: Add Group`
- `Favorites: Add Separator`
- `Favorites: Add Workspace File or Folder`
- `Favorites: Add from Clipboard`
- `Favorites: Move to…` (right-click item or group)
- `Favorites: Copy to…` (right-click item or group)
- `Favorites: Filter`
- `Favorites: Run Prompt` (or click a prompt favorite)
- `Favorites: Reveal Current File`
- `Favorites: Set Sort Order`
- `Favorites: Toggle Recent Section`
- `Favorites: Jump to Group`
- `Favorites: Export to JSON`
- `Favorites: Import from JSON`
- `Favorites: Remove Dead Links`
- `Favorites: Remove Duplicates`
- `Favorites: Launch Pinned #1` – `#9`
- `Favorites: Delete All Favorites`
- `Favorites: Reset All Icons & Colors`
- `Favorites: Reset All Settings to Defaults`
- `Favorites: Settings`
- `Favorites: Help & Feature Guide`

---

## Tips

- **Drag the panel** to the Secondary Side Bar (right side) if you prefer it there
- **Team favorites** are great for onboarding — commit `.vscode/favorites.json` with links to key files, run configs, and docs
- **Macros** can combine opening a file, running a build command, and launching a terminal command in one click
- **Pinned + `Ctrl+Alt+1`** gives you instant one-key access to your most-used file or command
- **Export scope shows in the filename** — `favorites-global.json` vs `favorites-workspace.json` so you always know what you're restoring
- **Empty panel** — right-click the placeholder item to get quick-add options without opening the `···` menu
