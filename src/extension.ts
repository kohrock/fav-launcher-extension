import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FavoritesProvider } from "./FavoritesProvider";
import { FavoriteItem, MacroStep, STORAGE_KEY, TEAM_STORAGE_FILE } from "./favoritesTypes";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getScope(context: vscode.ExtensionContext): "workspace" | "global" | "team" {
  return vscode.workspace.getConfiguration("favLauncher").get<"workspace" | "global" | "team">("storageScope", "workspace");
}

function getStorage(context: vscode.ExtensionContext): vscode.Memento {
  return getScope(context) === "global" ? context.globalState : context.workspaceState;
}

function loadItems(context: vscode.ExtensionContext): FavoriteItem[] {
  const scope = getScope(context);
  if (scope === "team") { return loadTeamItems(); }
  return getStorage(context).get<FavoriteItem[]>(STORAGE_KEY, []);
}

function loadTeamItems(): FavoriteItem[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return []; }
  const filePath = path.join(folders[0].uri.fsPath, TEAM_STORAGE_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FavoriteItem[];
  } catch { return []; }
}

async function saveItems(context: vscode.ExtensionContext, items: FavoriteItem[]): Promise<void> {
  const scope = getScope(context);
  if (scope === "team") {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }
    const filePath = path.join(folders[0].uri.fsPath, TEAM_STORAGE_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
    return;
  }
  await getStorage(context).update(STORAGE_KEY, items);
}

export function activate(context: vscode.ExtensionContext) {
  let items: FavoriteItem[] = loadItems(context);

  vscode.commands.executeCommand("setContext", "favLauncher.scope",
    vscode.workspace.getConfiguration("favLauncher").get("storageScope", "workspace")
  );

  const updateScopeContext = () => {
    vscode.commands.executeCommand("setContext", "favLauncher.scope",
      vscode.workspace.getConfiguration("favLauncher").get("storageScope", "workspace")
    );
  };

  const onReorder = async (draggedId: string, targetId: string | null, parentGroupId: string | undefined) => {
    const draggedIdx = items.findIndex(x => x.id === draggedId);
    if (draggedIdx === -1) { return; }
    const dragged = { ...items[draggedIdx], groupId: parentGroupId };
    items = items.filter(x => x.id !== draggedId);
    if (targetId === null) {
      const siblings = items.filter(x => x.groupId === parentGroupId);
      dragged.order = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) + 1 : 0;
      items = [...items, dragged];
    } else {
      const targetIdx = items.findIndex(x => x.id === targetId);
      if (targetIdx === -1) { return; }
      items.splice(targetIdx, 0, dragged);
      let order = 0;
      items = items.map(x => x.groupId === parentGroupId ? { ...x, order: order++ } : x);
    }
    await saveItems(context, items);
    provider.refresh();
  };

  const provider = new FavoritesProvider(() => items, onReorder);

  const treeView = vscode.window.createTreeView("favLauncher.favoritesView", {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const treeViewSidebar = vscode.window.createTreeView("favLauncher.favoritesViewSidebar", {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeViewSidebar);

  // Status bar
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  statusItem.tooltip = "Open Favorites";
  statusItem.command = "favLauncher.open";
  statusItem.show();
  context.subscriptions.push(statusItem);

  const updateStatus = () => {
    const realItems = items.filter(x => x.type !== "group" && x.type !== "separator");
    const count = realItems.length;
    const deadLinks = provider.countDeadLinks();
    statusItem.text = `$(star-full) Fav${count > 0 ? ` (${count})` : ""}${deadLinks > 0 ? ` $(warning)` : ""}`;

    // Build breakdown for tooltip
    const files = realItems.filter(x => x.type === "file").length;
    const commands = realItems.filter(x => x.type === "command").length;
    const macros = realItems.filter(x => x.type === "macro").length;
    const pinned = realItems.filter(x => x.pinned).length;
    const groups = items.filter(x => x.type === "group").length;
    const parts: string[] = [
      `${count} favorite${count !== 1 ? "s" : ""}`,
      files > 0 ? `${files} file${files !== 1 ? "s" : ""}` : "",
      commands > 0 ? `${commands} command${commands !== 1 ? "s" : ""}` : "",
      macros > 0 ? `${macros} macro${macros !== 1 ? "s" : ""}` : "",
      groups > 0 ? `${groups} group${groups !== 1 ? "s" : ""}` : "",
      pinned > 0 ? `${pinned} pinned` : "",
      deadLinks > 0 ? `⚠ ${deadLinks} missing` : "",
    ].filter(Boolean);
    statusItem.tooltip = parts.join("  •  ");
  };
  updateStatus();

  const doRefresh = async () => {
    await saveItems(context, items);
    updateStatus();
    provider.refresh();
  };

  // ── Git status polling ────────────────────────────────────────────────────
  const refreshGitStatus = async () => {
    try {
      const gitExt = vscode.extensions.getExtension("vscode.git")?.exports;
      if (!gitExt) { return; }
      const api = gitExt.getAPI(1);
      if (!api || api.repositories.length === 0) { return; }
      const repo = api.repositories[0];
      const statusMap = new Map<string, string>();
      for (const change of [...repo.state.workingTreeChanges, ...repo.state.indexChanges]) {
        const fsPath = change.uri.fsPath;
        const letter = String.fromCharCode(change.status + 65 > 90 ? 63 : change.status + 65);
        // Map numeric git status to letter
        const statusLetters: Record<number, string> = { 0: "?", 1: "A", 2: "D", 3: "M", 5: "M", 6: "R", 7: "C", 8: "U" };
        statusMap.set(fsPath, statusLetters[change.status] ?? "M");
      }
      provider.setGitStatus(statusMap);
    } catch { /* git not available */ }
  };

  // Poll git status every 30s and on save
  const gitPollInterval = setInterval(refreshGitStatus, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(gitPollInterval) });
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => refreshGitStatus()));
  refreshGitStatus();

  // ── Dirty-file badges ─────────────────────────────────────────────────────
  const refreshDirtyFiles = () => {
    const dirty = new Set(
      vscode.workspace.textDocuments
        .filter(d => d.isDirty && !d.isUntitled)
        .map(d => d.uri.fsPath)
    );
    provider.setDirtyFiles(dirty);
  };
  refreshDirtyFiles();
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => refreshDirtyFiles()));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => refreshDirtyFiles()));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(() => refreshDirtyFiles()));

  // Watch team file for changes
  let teamWatcher: vscode.FileSystemWatcher | undefined;
  const setupTeamWatcher = () => {
    teamWatcher?.dispose();
    if (getScope(context) === "team") {
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        const pattern = new vscode.RelativePattern(folders[0], TEAM_STORAGE_FILE);
        teamWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        teamWatcher.onDidChange(() => { items = loadItems(context); updateStatus(); provider.refresh(); });
        context.subscriptions.push(teamWatcher);
      }
    }
  };
  setupTeamWatcher();

  // ── Run on startup ────────────────────────────────────────────────────────
  const runOnStartup = async () => {
    const cfg = vscode.workspace.getConfiguration("favLauncher");
    const startupId = cfg.get<string>("startupItemId", "");
    if (!startupId) { return; }
    const target = items.find(x => x.id === startupId);
    if (!target) { return; }
    // Small delay so the workspace is fully ready
    setTimeout(async () => {
      if (target.type === "file" && target.path) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target.path));
      } else if (target.type === "command" && target.commandId) {
        await vscode.commands.executeCommand(target.commandId, ...(target.args ?? []));
      } else if (target.type === "macro") {
        await vscode.commands.executeCommand("favLauncher.runMacro", target);
      }
    }, 1500);
  };
  runOnStartup();

  // ── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.favLauncher");
      await vscode.commands.executeCommand("favLauncher.favoritesView.focus");
    })
  );

  // Filter
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.filterFavorites", async () => {
      const text = await vscode.window.showInputBox({
        title: "Filter Favorites",
        placeHolder: "Type to filter by name, path or note… (leave blank to clear)",
        value: "",
      });
      if (text === undefined) { return; }
      provider.setFilter(text.trim());
      if (text.trim()) {
        vscode.window.showInformationMessage(`Favorites filtered: "${text.trim()}" — click Clear Filter to reset.`, "Clear Filter")
          .then(v => { if (v) { provider.setFilter(""); } });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.clearFilter", () => { provider.setFilter(""); })
  );

  // Add file
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addCurrentFile", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true, canSelectFolders: true, canSelectMany: true,
        openLabel: "Add to Favorites", title: "Pick files or folders to favorite",
      });
      if (!uris || uris.length === 0) { return; }
      await addFileUris(uris);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addFromExplorer", async (uri?: vscode.Uri, allUris?: vscode.Uri[]) => {
      const urisToAdd = allUris && allUris.length > 0 ? allUris : uri ? [uri] : undefined;
      if (!urisToAdd) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        await addFileUris([editor.document.uri]);
        return;
      }
      await addFileUris(urisToAdd);
    })
  );

  async function addFileUris(uris: vscode.Uri[]) {
    const groupId = await pickGroup();
    const newUris = uris.filter(u => !items.some(x => x.type === "file" && x.path === u.fsPath));
    const skipped = uris.length - newUris.length;
    if (newUris.length === 0) { vscode.window.showInformationMessage("All selected items are already in Favorites."); return; }

    if (newUris.length === 1) {
      const fsPath = newUris[0].fsPath;
      const defaultLabel = fsPath.split(/[\\/]/).pop() ?? fsPath;
      const label = (await vscode.window.showInputBox({ title: "Label", value: defaultLabel, prompt: "Give it a friendly name" })) ?? defaultLabel;
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      items = [...items, { id: newId(), type: "file", label, path: fsPath, order: maxOrder + 1, groupId }];
    } else {
      let nextOrder = items.filter(x => x.groupId === groupId).length > 0
        ? Math.max(...items.filter(x => x.groupId === groupId).map(x => x.order)) + 1 : 0;
      items = [...items, ...newUris.map(u => ({
        id: newId(), type: "file" as const,
        label: u.fsPath.split(/[\\/]/).pop() ?? u.fsPath,
        path: u.fsPath, order: nextOrder++, groupId,
      }))];
    }
    await doRefresh();
    const msg = newUris.length === 1
      ? `Added "${newUris[0].fsPath.split(/[\\/]/).pop()}" to Favorites.`
      : `Added ${newUris.length} items to Favorites.${skipped > 0 ? ` (${skipped} already existed)` : ""}`;
    vscode.window.showInformationMessage(msg);
  }

  // Add command
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addCommand", async () => {
      const POPULAR: vscode.QuickPickItem[] = [
        { label: "$(terminal) New Terminal",               description: "workbench.action.terminal.new" },
        { label: "$(split-horizontal) Split Terminal",     description: "workbench.action.terminal.split" },
        { label: "$(file) New File",                       description: "workbench.action.files.newUntitledFile" },
        { label: "$(folder) Open Folder",                  description: "workbench.action.files.openFolder" },
        { label: "$(search) Find in Files",                description: "workbench.action.findInFiles" },
        { label: "$(go-to-file) Go to File",               description: "workbench.action.quickOpen" },
        { label: "$(symbol-class) Go to Symbol",           description: "workbench.action.gotoSymbol" },
        { label: "$(debug-start) Start Debugging",         description: "workbench.action.debug.start" },
        { label: "$(debug-restart) Restart Debugging",     description: "workbench.action.debug.restart" },
        { label: "$(extensions) Show Extensions",          description: "workbench.view.extensions" },
        { label: "$(source-control) Show Source Control",  description: "workbench.view.scm" },
        { label: "$(beaker) Show Test Explorer",           description: "workbench.view.testing.focus" },
        { label: "$(color-mode) Toggle Color Theme",       description: "workbench.action.selectTheme" },
        { label: "$(settings-gear) Open Settings",         description: "workbench.action.openSettings" },
        { label: "$(keyboard) Open Keyboard Shortcuts",    description: "workbench.action.openGlobalKeybindings" },
        { label: "$(git-branch) Checkout Branch",          description: "git.checkout" },
        { label: "$(repo-sync) Git Pull",                  description: "git.pull" },
        { label: "$(cloud-upload) Git Push",               description: "git.push" },
        { label: "$(refresh) Reload Window",               description: "workbench.action.reloadWindow" },
        { label: "$(zoom-in) Zoom In",                     description: "workbench.action.zoomIn" },
        { label: "$(zoom-out) Zoom Out",                   description: "workbench.action.zoomOut" },
        { label: "$(close-all) Close All Editors",         description: "workbench.action.closeAllEditors" },
        { label: "$(layout-sidebar-left-off) Toggle Sidebar", description: "workbench.action.toggleSidebarVisibility" },
        { label: "$(layout-panel-off) Toggle Panel",       description: "workbench.action.togglePanel" },
        { label: "$(word-wrap) Toggle Word Wrap",          description: "editor.action.toggleWordWrap" },
        { label: "$(format-indent-size) Format Document",  description: "editor.action.formatDocument" },
        { label: "$(symbol-variable) Rename Symbol",       description: "editor.action.rename" },
        { label: "$(lightbulb) Quick Fix",                 description: "editor.action.quickFix" },
        { label: "$(list-flat) Show All Commands",         description: "workbench.action.showCommands" },
        { label: "", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
        { label: "$(edit) Type a command ID manually...",  description: "__manual__" },
      ];
      const picked = await vscode.window.showQuickPick(POPULAR, { title: "Add Command to Favorites", matchOnDescription: true });
      if (!picked) { return; }
      let commandId: string;
      let defaultLabel: string;
      if (picked.description === "__manual__") {
        const typed = await vscode.window.showInputBox({ title: "Enter Command ID", placeHolder: "e.g. workbench.action.terminal.new" });
        if (!typed?.trim()) { return; }
        commandId = typed.trim(); defaultLabel = commandId;
      } else {
        commandId = picked.description!;
        defaultLabel = picked.label.replace(/\$\([^)]+\)\s*/, "");
      }
      if (items.some(x => x.type === "command" && x.commandId === commandId)) {
        vscode.window.showInformationMessage("Command is already in Favorites."); return;
      }
      const groupId = await pickGroup();
      const label = (await vscode.window.showInputBox({ title: "Label", value: defaultLabel })) ?? defaultLabel;
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      items = [...items, { id: newId(), type: "command", label, commandId, order: maxOrder + 1, groupId }];
      await doRefresh();
    })
  );

  // Add macro
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addMacro", async () => {
      const label = await vscode.window.showInputBox({ title: "Macro name", placeHolder: "e.g. Deploy" });
      if (!label) { return; }
      const macroSteps: MacroStep[] = [];
      while (true) {
        const stepType = await vscode.window.showQuickPick([
          { label: "$(run) VS Code command", description: "e.g. git.push", value: "command" },
          { label: "$(terminal) Terminal command", description: "e.g. npm run build", value: "terminal" },
          { label: "$(check) Done — finish macro", value: "done" },
        ], { title: `Step ${macroSteps.length + 1}${macroSteps.length > 0 ? ` (${macroSteps.length} so far)` : ""}` });
        if (!stepType || stepType.value === "done") { break; }
        if (stepType.value === "command") {
          const cmd = await vscode.window.showInputBox({ title: "VS Code command ID", placeHolder: "e.g. git.push" });
          if (cmd?.trim()) { macroSteps.push({ kind: "command", commandId: cmd.trim() }); }
        } else {
          const txt = await vscode.window.showInputBox({ title: "Terminal command", placeHolder: "e.g. npm run build" });
          if (txt?.trim()) { macroSteps.push({ kind: "terminal", text: txt.trim() }); }
        }
      }
      if (macroSteps.length === 0) { return; }
      const groupId = await pickGroup();
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      items = [...items, { id: newId(), type: "macro", label, macroSteps, order: maxOrder + 1, groupId }];
      await doRefresh();
    })
  );

  // Run macro
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.runMacro", async (node: FavoriteItem) => {
      const steps: MacroStep[] = node.macroSteps ??
        (node.macroCommands ?? []).map(c => ({ kind: "command" as const, commandId: c }));
      let terminal: vscode.Terminal | undefined;
      // Track last used
      items = items.map(x => x.id === node.id ? { ...x, lastUsed: Date.now() } : x);
      await saveItems(context, items);
      for (const step of steps) {
        if (step.kind === "command") {
          await vscode.commands.executeCommand(step.commandId);
        } else {
          if (!terminal || terminal.exitStatus !== undefined) {
            terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal("Fav Macro");
          }
          terminal.show(true);
          terminal.sendText(step.text);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    })
  );

  // Edit macro
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editMacro", async (node: FavoriteItem) => {
      if (node.type !== "macro") { return; }
      const existing: MacroStep[] = node.macroSteps ??
        (node.macroCommands ?? []).map(c => ({ kind: "command" as const, commandId: c }));
      const edited: MacroStep[] = [];
      for (let i = 0; i < existing.length; i++) {
        const step = existing[i];
        const icon = step.kind === "terminal" ? "$(terminal)" : "$(run)";
        const currentVal = step.kind === "terminal" ? step.text : step.commandId;
        const action = await vscode.window.showQuickPick([
          { label: `${icon} Keep: ${currentVal}`, value: "keep" },
          { label: "$(edit) Edit", value: "edit" },
          { label: "$(trash) Remove", value: "remove" },
        ], { title: `Step ${i + 1}: ${currentVal}` });
        if (action === undefined) { return; }
        if (action.value === "remove") { continue; }
        if (action.value === "keep") { edited.push(step); continue; }
        const newVal = await vscode.window.showInputBox({ title: `Edit step ${i + 1}`, value: currentVal });
        if (!newVal?.trim()) { continue; }
        edited.push(step.kind === "terminal" ? { kind: "terminal", text: newVal.trim() } : { kind: "command", commandId: newVal.trim() });
      }
      while (true) {
        const stepType = await vscode.window.showQuickPick([
          { label: "$(run) Add VS Code command", value: "command" },
          { label: "$(terminal) Add terminal command", value: "terminal" },
          { label: "$(check) Done", value: "done" },
        ], { title: `Add step ${edited.length + 1} (optional)` });
        if (!stepType || stepType.value === "done") { break; }
        if (stepType.value === "command") {
          const val = await vscode.window.showInputBox({ title: "VS Code command ID" });
          if (val?.trim()) { edited.push({ kind: "command", commandId: val.trim() }); }
        } else {
          const val = await vscode.window.showInputBox({ title: "Terminal command" });
          if (val?.trim()) { edited.push({ kind: "terminal", text: val.trim() }); }
        }
      }
      if (edited.length === 0) { vscode.window.showWarningMessage("Macro needs at least one step."); return; }
      items = items.map(x => x.id === node.id ? { ...x, macroSteps: edited, macroCommands: undefined } : x);
      await doRefresh();
    })
  );

  // Add separator
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addSeparator", async () => {
      const groupId = await pickGroup();
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      items = [...items, { id: newId(), type: "separator", label: "---", order: maxOrder + 1, groupId }];
      await doRefresh();
    })
  );

  // Add group
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addGroup", async () => {
      const label = await vscode.window.showInputBox({ title: "Group name", placeHolder: "e.g. Work" });
      if (!label) { return; }
      const maxOrder = items.filter(x => !x.groupId).length > 0
        ? Math.max(...items.filter(x => !x.groupId).map(x => x.order)) : -1;
      items = [...items, { id: newId(), type: "group", label, order: maxOrder + 1 }];
      await doRefresh();
    })
  );

  // Rename
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.renameItem", async (node: FavoriteItem) => {
      const label = await vscode.window.showInputBox({ title: "Rename", value: node.label });
      if (!label) { return; }
      items = items.map(x => x.id === node.id ? { ...x, label } : x);
      await doRefresh();
    })
  );

  // Pin / Unpin
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.pinItem", async (node: FavoriteItem) => {
      items = items.map(x => x.id === node.id ? { ...x, pinned: true } : x);
      await doRefresh();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.unpinItem", async (node: FavoriteItem) => {
      items = items.map(x => x.id === node.id ? { ...x, pinned: false } : x);
      await doRefresh();
    })
  );

  // Move to group
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.moveToGroup", async (node: FavoriteItem) => {
      const groupId = await pickGroup();
      const siblings = items.filter(x => x.groupId === groupId && x.id !== node.id);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      items = items.map(x => x.id === node.id ? { ...x, groupId, order: maxOrder + 1 } : x);
      await doRefresh();
    })
  );

  // Duplicate
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.duplicateItem", async (node: FavoriteItem) => {
      const siblings = items.filter(x => x.groupId === node.groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      const dupe: FavoriteItem = { ...node, id: newId(), label: `${node.label} (copy)`, order: maxOrder + 1, pinned: false };
      items = [...items, dupe];
      await doRefresh();
    })
  );

  // Custom icon
  const COMMON_ICONS = [
    "star","rocket","heart","bookmark","tag","flame","zap","bell","globe","home",
    "briefcase","wrench","beaker","bug","database","cloud","lock","key","shield",
    "package","repo","git-branch","terminal","file-code","folder","run","play",
    "debug","check","x","info","warning","question","light-bulb","coffee","robot",
  ];
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.setIcon", async (node: FavoriteItem) => {
      const picks: vscode.QuickPickItem[] = [
        { label: "$(circle-slash) No icon (default)", description: "__none__" },
        ...COMMON_ICONS.map(i => ({ label: `$(${i}) ${i}`, description: i })),
        { label: "$(edit) Type a codicon name...", description: "__custom__" },
      ];
      const picked = await vscode.window.showQuickPick(picks, { title: "Choose an icon", matchOnDescription: true });
      if (!picked) { return; }
      let icon: string | undefined;
      if (picked.description === "__none__") { icon = undefined; }
      else if (picked.description === "__custom__") {
        const val = await vscode.window.showInputBox({ title: "Codicon name", placeHolder: "e.g. rocket, star, flame" });
        if (!val?.trim()) { return; }
        icon = val.trim();
      } else { icon = picked.description; }
      items = items.map(x => x.id === node.id ? { ...x, icon } : x);
      await doRefresh();
    })
  );

  // Add / Edit note
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editNote", async (node: FavoriteItem) => {
      const note = await vscode.window.showInputBox({
        title: node.note ? "Edit Note" : "Add Note",
        value: node.note ?? "",
        prompt: "Leave blank to remove the note",
        placeHolder: "e.g. Main entry point, run before deploying...",
      });
      if (note === undefined) { return; }
      items = items.map(x => x.id === node.id ? { ...x, note: note.trim() || undefined } : x);
      await doRefresh();
    })
  );

  // Edit macro steps (alias shown in menu)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editMacroAlias", (node: FavoriteItem) =>
      vscode.commands.executeCommand("favLauncher.editMacro", node)
    )
  );

  // Reveal folder in explorer
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.revealInExplorer", async (uri: vscode.Uri) => {
      await vscode.commands.executeCommand("revealInExplorer", uri);
    })
  );

  // Open in current window
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openInCurrentWindow", async (node: FavoriteItem) => {
      if (node.type === "file" && node.path) {
        // Track last used
        items = items.map(x => x.id === node.id ? { ...x, lastUsed: Date.now() } : x);
        await saveItems(context, items);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.path), vscode.ViewColumn.Active);
      }
    })
  );

  // Open to side
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openToSide", async (node: FavoriteItem) => {
      if (node.type === "file" && node.path) {
        items = items.map(x => x.id === node.id ? { ...x, lastUsed: Date.now() } : x);
        await saveItems(context, items);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.path), vscode.ViewColumn.Beside);
      }
    })
  );

  // Remove with undo
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeItem", async (node: FavoriteItem) => {
      if (!node) { return; }
      const removed = node.type === "group"
        ? items.filter(x => x.id === node.id || x.groupId === node.id)
        : items.filter(x => x.id === node.id);
      items = node.type === "group"
        ? items.filter(x => x.id !== node.id && x.groupId !== node.id)
        : items.filter(x => x.id !== node.id);
      await doRefresh();
      const action = await vscode.window.showInformationMessage(
        `Removed "${node.label}".`, "Undo"
      );
      if (action === "Undo") {
        items = [...items, ...removed];
        await doRefresh();
      }
    })
  );

  // Sort
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.setSortOrder", async () => {
      const current = vscode.workspace.getConfiguration("favLauncher").get<string>("sortOrder", "manual");
      const picked = await vscode.window.showQuickPick([
        { label: "$(list-ordered) Manual (drag & drop)", description: "manual", picked: current === "manual" },
        { label: "$(sort-precedence) Alphabetical", description: "alpha", picked: current === "alpha" },
        { label: "$(symbol-misc) By Type", description: "type", picked: current === "type" },
        { label: "$(history) By Last Used", description: "lastUsed", picked: current === "lastUsed" },
      ], { title: "Sort Favorites" });
      if (!picked) { return; }
      await vscode.workspace.getConfiguration("favLauncher").update("sortOrder", picked.description, vscode.ConfigurationTarget.Global);
      provider.refresh();
    })
  );

  // Export
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.exportFavorites", async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { JSON: ["json"] }, saveLabel: "Export Favorites", defaultUri: vscode.Uri.file("favorites.json") });
      if (!uri) { return; }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(items, null, 2), "utf8"));
      await context.globalState.update("favLauncher.lastBackupMs", Date.now());
      vscode.window.showInformationMessage("Favorites exported.");
    })
  );

  // Import with diff preview
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.importFavorites", async () => {
      const uris = await vscode.window.showOpenDialog({ filters: { JSON: ["json"] }, openLabel: "Import Favorites", canSelectMany: false });
      if (!uris || uris.length === 0) { return; }
      const raw = await vscode.workspace.fs.readFile(uris[0]);
      const imported: FavoriteItem[] = JSON.parse(Buffer.from(raw).toString("utf8"));

      const existingIds = new Set(items.map(x => x.id));
      const existingPaths = new Set(items.filter(x => x.path).map(x => x.path!));
      const newItems = imported.filter(x => !existingIds.has(x.id) && (!x.path || !existingPaths.has(x.path)));
      const dupes = imported.filter(x => existingIds.has(x.id) || (x.path && existingPaths.has(x.path)));

      // Show diff summary
      const diffLines = [
        `📦 Import preview from: ${path.basename(uris[0].fsPath)}`,
        ``,
        `✅ New items (${newItems.length}):`,
        ...newItems.map(x => `  + ${x.label} (${x.type})`),
        dupes.length > 0 ? `\n⏭ Already exists (${dupes.length}):` : "",
        ...dupes.map(x => `  = ${x.label} (${x.type})`),
      ].filter(Boolean).join("\n");

      const choice = await vscode.window.showQuickPick([
        { label: `$(add) Merge — add ${newItems.length} new items`, description: `skip ${dupes.length} duplicates`, value: "merge" },
        { label: `$(replace-all) Replace all — overwrite with ${imported.length} items`, value: "replace" },
        { label: "$(eye) Preview diff in editor", value: "preview" },
      ], { title: `Import Favorites — ${newItems.length} new, ${dupes.length} duplicate` });

      if (!choice) { return; }

      if (choice.value === "preview") {
        const doc = await vscode.workspace.openTextDocument({ content: diffLines, language: "markdown" });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        return;
      }

      if (choice.value === "replace") { items = imported; }
      else { items = [...items, ...newItems]; }

      await doRefresh();
      vscode.window.showInformationMessage(
        choice.value === "replace"
          ? `Replaced favorites with ${imported.length} items.`
          : `Added ${newItems.length} new items. Skipped ${dupes.length} duplicates.`
      );
    })
  );

  // Open settings
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "favLauncher")
    )
  );

  // Scroll to current file in panel
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.revealCurrentFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const fsPath = editor.document.uri.fsPath;
      const match = items.find(x => x.type === "file" && x.path === fsPath);
      if (!match) {
        vscode.window.showInformationMessage("Current file is not in Favorites.");
        return;
      }
      await vscode.commands.executeCommand("favLauncher.favoritesView.focus");
      treeView.reveal(match, { select: true, focus: true });
    })
  );

  // Auto-reveal current file when editor changes (if setting enabled)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) { return; }
      const autoReveal = vscode.workspace.getConfiguration("favLauncher").get<boolean>("autoRevealCurrentFile", false);
      if (!autoReveal) { return; }
      const fsPath = editor.document.uri.fsPath;
      const match = items.find(x => x.type === "file" && x.path === fsPath);
      if (match) { treeView.reveal(match, { select: true, focus: false }); }
    })
  );

  // Copy path
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.copyPath", async (node: FavoriteItem) => {
      if (node.type === "file" && node.path) {
        await vscode.env.clipboard.writeText(node.path);
        vscode.window.showInformationMessage(`Copied: ${node.path}`);
      }
    })
  );

  // Copy relative path
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.copyRelativePath", async (node: FavoriteItem) => {
      if (node.type === "file" && node.path) {
        const folders = vscode.workspace.workspaceFolders;
        let rel = node.path;
        if (folders) {
          for (const f of folders) {
            const root = f.uri.fsPath;
            if (node.path.startsWith(root)) {
              rel = node.path.slice(root.length).replace(/^[\\/]/, "");
              break;
            }
          }
        }
        await vscode.env.clipboard.writeText(rel);
        vscode.window.showInformationMessage(`Copied: ${rel}`);
      }
    })
  );

  // Reset style (clear icon + color on one item)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.resetStyle", async (node: FavoriteItem) => {
      items = items.map(x => x.id === node.id ? { ...x, icon: undefined, color: undefined } : x);
      await doRefresh();
    })
  );

  // Reset all icons & colors on all items
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.resetAllStyles", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Remove all custom icons and colors from every favorite?",
        { modal: true },
        "Reset All"
      );
      if (confirm !== "Reset All") { return; }
      items = items.map(x => ({ ...x, icon: undefined, color: undefined }));
      await doRefresh();
      vscode.window.showInformationMessage("All icons and colors have been reset.");
    })
  );

  // Reset all settings to defaults
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.resetAllSettings", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset all Fav Launcher settings to defaults?",
        { modal: true },
        "Reset"
      );
      if (confirm !== "Reset") { return; }

      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const keys = [
        "storageScope", "noteDisplay", "itemDescription", "sortOrder",
        "compactMode", "autoRevealCurrentFile", "backupReminderDays",
        "showRecentSection", "startupItemId",
      ];
      for (const key of keys) {
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      }

      updateScopeContext();
      provider.refresh();
      vscode.window.showInformationMessage("Fav Launcher settings reset to defaults.");
    })
  );

  // Set color label
  const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "none"];
  const COLOR_LABELS: Record<string, string> = {
    red: "$(circle-filled) Red", orange: "$(circle-filled) Orange",
    yellow: "$(circle-filled) Yellow", green: "$(circle-filled) Green",
    blue: "$(circle-filled) Blue", purple: "$(circle-filled) Purple",
    none: "$(circle-slash) No color",
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.setColor", async (node: FavoriteItem) => {
      const picked = await vscode.window.showQuickPick(
        COLORS.map(c => ({ label: COLOR_LABELS[c], description: c, picked: node.color === c })),
        { title: "Set color label" }
      );
      if (!picked) { return; }
      const color = picked.description === "none" ? undefined : picked.description;
      items = items.map(x => x.id === node.id ? { ...x, color } : x);
      await doRefresh();
    })
  );

  // Quick launch Ctrl+1 through Ctrl+9
  for (let i = 1; i <= 9; i++) {
    const idx = i - 1;
    context.subscriptions.push(
      vscode.commands.registerCommand(`favLauncher.launchPinned${i}`, async () => {
        const pinned = items
          .filter(x => x.pinned && x.type !== "group" && x.type !== "separator")
          .sort((a, b) => a.order - b.order);
        const target = pinned[idx];
        if (!target) {
          vscode.window.showInformationMessage(`No pinned favorite #${i}. Pin items to use Ctrl+${i}.`);
          return;
        }
        if (target.type === "file" && target.path) {
          items = items.map(x => x.id === target.id ? { ...x, lastUsed: Date.now() } : x);
          await saveItems(context, items);
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target.path), vscode.ViewColumn.Active);
        } else if (target.type === "command" && target.commandId) {
          items = items.map(x => x.id === target.id ? { ...x, lastUsed: Date.now() } : x);
          await saveItems(context, items);
          await vscode.commands.executeCommand(target.commandId, ...(target.args ?? []));
        } else if (target.type === "macro") {
          await vscode.commands.executeCommand("favLauncher.runMacro", target);
        }
      })
    );
  }

  // Switch scope shortcuts
  const switchScope = async (scope: "global" | "workspace" | "team") => {
    await vscode.workspace.getConfiguration("favLauncher").update("storageScope", scope, vscode.ConfigurationTarget.Global);
    items = loadItems(context);
    updateScopeContext();
    updateStatus();
    setupTeamWatcher();
    provider.refresh();
    const count = items.filter(x => x.type !== "group" && x.type !== "separator").length;
    vscode.window.showInformationMessage(`Favorites: switched to ${scope} storage (${count} item${count !== 1 ? "s" : ""}).`);
  };

  context.subscriptions.push(vscode.commands.registerCommand("favLauncher.switchToGlobal", () => switchScope("global")));
  context.subscriptions.push(vscode.commands.registerCommand("favLauncher.switchToWorkspace", () => switchScope("workspace")));
  context.subscriptions.push(vscode.commands.registerCommand("favLauncher.switchToTeam", () => switchScope("team")));

  // Config change handler
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("favLauncher.storageScope")) {
        items = loadItems(context);
        updateScopeContext();
        updateStatus();
        setupTeamWatcher();
        provider.refresh();
        vscode.window.showInformationMessage(`Favorites: switched to ${getScope(context)} storage.`);
      } else if (
        e.affectsConfiguration("favLauncher.noteDisplay") ||
        e.affectsConfiguration("favLauncher.itemDescription") ||
        e.affectsConfiguration("favLauncher.sortOrder") ||
        e.affectsConfiguration("favLauncher.compactMode")
      ) {
        provider.refresh();
      }
    })
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function pickGroup(): Promise<string | undefined> {
    const groups = items.filter(x => x.type === "group");
    if (groups.length === 0) { return undefined; }
    const picks: vscode.QuickPickItem[] = [
      { label: "$(root-folder) Root (no group)", description: "__root__" },
      ...groups.map(g => ({ label: `$(folder) ${g.label}`, description: g.id })),
    ];
    const picked = await vscode.window.showQuickPick(picks, { title: "Add to group" });
    if (!picked || picked.description === "__root__") { return undefined; }
    return picked.description;
  }

  // ── Quick add from clipboard ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addFromClipboard", async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text?.trim()) {
        vscode.window.showWarningMessage("Clipboard is empty.");
        return;
      }
      const trimmed = text.trim();
      // Detect whether it looks like a file path
      const looksLikePath = /^[a-zA-Z]:[/\\]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || fs.existsSync(trimmed);
      const type = looksLikePath ? "file" : "command";

      const label = await vscode.window.showInputBox({
        title: "Add from clipboard",
        prompt: `Label for "${trimmed.slice(0, 60)}"`,
        value: path.basename(trimmed) || trimmed.slice(0, 30),
      });
      if (label === undefined) { return; }

      const groupId = await pickGroup();
      const newItem: FavoriteItem = {
        id: newId(),
        type,
        label: label || path.basename(trimmed) || trimmed.slice(0, 30),
        order: items.length,
        groupId,
        ...(type === "file" ? { path: trimmed } : { commandId: trimmed }),
      };
      items = [...items, newItem];
      await doRefresh();
      vscode.window.showInformationMessage(`Added "${newItem.label}" from clipboard.`);
    })
  );

  // ── Scan & remove dead links ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeDeadLinks", async () => {
      const dead = items.filter(x => x.type === "file" && x.path && !fs.existsSync(x.path));
      if (dead.length === 0) {
        vscode.window.showInformationMessage("No dead links found — all file favorites exist.");
        return;
      }
      const list = dead.map(x => `• ${x.label} (${x.path})`).join("\n");
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${dead.length} dead link${dead.length > 1 ? "s" : ""}?\n\n${list}`,
        { modal: true },
        "Remove All"
      );
      if (confirm !== "Remove All") { return; }
      const deadIds = new Set(dead.map(x => x.id));
      items = items.filter(x => !deadIds.has(x.id));
      await doRefresh();
      vscode.window.showInformationMessage(`Removed ${dead.length} dead link${dead.length > 1 ? "s" : ""}.`);
    })
  );

  // ── Remove duplicates ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeDuplicates", async () => {
      const seen = new Set<string>();
      const dupes: FavoriteItem[] = [];
      for (const item of items) {
        const key = item.type === "file"
          ? `file:${item.path}`
          : item.type === "command"
            ? `cmd:${item.commandId}`
            : `other:${item.label}`;
        if (seen.has(key)) {
          dupes.push(item);
        } else {
          seen.add(key);
        }
      }
      if (dupes.length === 0) {
        vscode.window.showInformationMessage("No duplicates found.");
        return;
      }
      const list = dupes.map(x => `• ${x.label}`).join("\n");
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${dupes.length} duplicate${dupes.length > 1 ? "s" : ""}?\n\n${list}`,
        { modal: true },
        "Remove Duplicates"
      );
      if (confirm !== "Remove Duplicates") { return; }
      const dupeIds = new Set(dupes.map(x => x.id));
      items = items.filter(x => !dupeIds.has(x.id));
      await doRefresh();
      vscode.window.showInformationMessage(`Removed ${dupes.length} duplicate${dupes.length > 1 ? "s" : ""}.`);
    })
  );

  // ── Jump to group (quick pick) ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.jumpToGroup", async () => {
      const groups = items.filter(x => x.type === "group");
      if (groups.length === 0) {
        vscode.window.showInformationMessage("No groups yet. Use Add Group to create one.");
        return;
      }
      const picks = groups.map(g => {
        const count = items.filter(x => x.groupId === g.id && x.type !== "separator").length;
        return { label: `$(folder) ${g.label}`, description: `${count} item${count !== 1 ? "s" : ""}`, id: g.id };
      });
      const picked = await vscode.window.showQuickPick(picks, { title: "Jump to group" });
      if (!picked) { return; }
      const group = items.find(x => x.id === (picked as any).id);
      if (group) {
        await treeView.reveal(group, { select: true, focus: true, expand: true });
      }
    })
  );

  // ── Open all files in a group ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openAllInGroup", async (node: FavoriteItem) => {
      if (node.type !== "group") { return; }
      const children = items.filter(x => x.groupId === node.id && x.type === "file" && x.path);
      if (children.length === 0) {
        vscode.window.showInformationMessage(`No file items in group "${node.label}".`);
        return;
      }
      for (const child of children) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(child.path!));
      }
      vscode.window.showInformationMessage(`Opened ${children.length} file${children.length !== 1 ? "s" : ""} from "${node.label}".`);
    })
  );

  // ── Close all editors in a group ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.closeAllInGroup", async (node: FavoriteItem) => {
      if (node.type !== "group") { return; }
      const paths = new Set(
        items.filter(x => x.groupId === node.id && x.type === "file" && x.path).map(x => x.path!)
      );
      const openTabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
      let closed = 0;
      for (const tab of openTabs) {
        const input = tab.input as any;
        if (input?.uri && paths.has(input.uri.fsPath)) {
          await vscode.window.tabGroups.close(tab);
          closed++;
        }
      }
      vscode.window.showInformationMessage(
        closed > 0 ? `Closed ${closed} file${closed !== 1 ? "s" : ""} from "${node.label}".` : `No open editors matched group "${node.label}".`
      );
    })
  );

  // ── Item count breakdown (status bar tooltip) ─────────────────────────────
  // Handled inside updateStatus() below — extended to include breakdown

  // ── Backup reminder ───────────────────────────────────────────────────────
  const checkBackupReminder = async () => {
    const cfg = vscode.workspace.getConfiguration("favLauncher");
    const intervalDays = cfg.get<number>("backupReminderDays", 0);
    if (!intervalDays) { return; }
    const lastBackup = context.globalState.get<number>("favLauncher.lastBackupMs", 0);
    const daysSince = (Date.now() - lastBackup) / (1000 * 60 * 60 * 24);
    if (daysSince >= intervalDays) {
      const action = await vscode.window.showInformationMessage(
        `Fav Launcher: It's been ${Math.floor(daysSince)} day${daysSince >= 2 ? "s" : ""} since your last favorites backup.`,
        "Export Now",
        "Dismiss"
      );
      if (action === "Export Now") {
        await vscode.commands.executeCommand("favLauncher.exportFavorites");
        await context.globalState.update("favLauncher.lastBackupMs", Date.now());
      } else if (action === "Dismiss") {
        await context.globalState.update("favLauncher.lastBackupMs", Date.now());
      }
    }
  };
  checkBackupReminder();

  // ── Add workspace switcher item ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addWorkspace", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Add as Workspace Favorite",
        filters: { "Workspace / Folder": ["code-workspace", "*"] },
      });
      if (!uris || uris.length === 0) { return; }
      const wsPath = uris[0].fsPath;
      const defaultLabel = path.basename(wsPath).replace(/\.code-workspace$/, "");
      const label = await vscode.window.showInputBox({ title: "Workspace label", value: defaultLabel });
      if (label === undefined) { return; }
      const groupId = await pickGroup();
      const newItem: FavoriteItem = {
        id: newId(), type: "workspace", label: label || defaultLabel,
        order: items.length, groupId, workspacePath: wsPath,
      };
      items = [...items, newItem];
      await doRefresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openWorkspace", async (node: FavoriteItem) => {
      if (!node.workspacePath) { return; }
      items = items.map(x => x.id === node.id ? { ...x, lastUsed: Date.now() } : x);
      await saveItems(context, items);
      const uri = vscode.Uri.file(node.workspacePath);
      await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
    })
  );

  // ── Set startup item ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.setStartupItem", async (node: FavoriteItem) => {
      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const current = cfg.get<string>("startupItemId", "");
      if (current === node.id) {
        // Toggle off
        await cfg.update("startupItemId", "", vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Startup item cleared.`);
      } else {
        await cfg.update("startupItemId", node.id, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`"${node.label}" will open automatically when this workspace starts.`);
      }
    })
  );

  // ── Edit separator label ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editSeparatorLabel", async (node: FavoriteItem) => {
      if (node.type !== "separator") { return; }
      const label = await vscode.window.showInputBox({
        title: "Separator label (leave blank for plain line)",
        value: node.separatorLabel ?? "",
        placeHolder: "e.g. Work, Personal, …",
      });
      if (label === undefined) { return; }
      items = items.map(x => x.id === node.id ? { ...x, separatorLabel: label.trim() || undefined } : x);
      await doRefresh();
    })
  );

  // ── Edit command args ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editArgs", async (node: FavoriteItem) => {
      if (node.type !== "command") { return; }
      const current = JSON.stringify(node.args ?? [], null, 2);
      const input = await vscode.window.showInputBox({
        title: `Args for "${node.label}"`,
        prompt: "Enter a JSON array, e.g. [\"arg1\", { \"key\": true }]",
        value: current,
        validateInput: v => {
          try { const p = JSON.parse(v); if (!Array.isArray(p)) { return "Must be a JSON array"; } return null; }
          catch { return "Invalid JSON"; }
        },
      });
      if (input === undefined) { return; }
      const newArgs = JSON.parse(input);
      items = items.map(x => x.id === node.id ? { ...x, args: newArgs } : x);
      await doRefresh();
      vscode.window.showInformationMessage(`Args updated for "${node.label}".`);
    })
  );

  // ── Toggle showRecentSection ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.toggleRecentSection", async () => {
      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const current = cfg.get<boolean>("showRecentSection", false);
      await cfg.update("showRecentSection", !current, vscode.ConfigurationTarget.Global);
      provider.refresh();
      vscode.window.showInformationMessage(`Recent section ${!current ? "enabled" : "disabled"}.`);
    })
  );

  // ── Help / README ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openHelp", async () => {
      const readmePath = path.join(context.extensionPath, "README.md");
      const uri = vscode.Uri.file(readmePath);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    })
  );
}

export function deactivate() {}
