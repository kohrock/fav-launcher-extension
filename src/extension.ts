import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FavoritesProvider } from "./FavoritesProvider";
import { FavoriteItem, MacroStep, STORAGE_KEY, TEAM_STORAGE_FILE } from "./favoritesTypes";
import { PROMPT_TEMPLATES, PromptTemplate } from "./promptTemplates";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Open a file, focusing the existing tab if it's already open rather than duplicating it. */
async function openFile(fsPath: string, beside = false): Promise<void> {
  const uri = vscode.Uri.file(fsPath);

  if (!beside) {
    // Check all tab groups for an existing tab with this URI
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as any;
        if (input?.uri && input.uri.fsPath === fsPath) {
          // File is already open — just focus that tab
          await vscode.commands.executeCommand("vscode.open", uri, {
            viewColumn: group.viewColumn,
            preserveFocus: false,
          });
          return;
        }
      }
    }
  }

  // Not open yet — open normally
  await vscode.commands.executeCommand(
    "vscode.open", uri,
    beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
  );
}

type FavScope = "workspace" | "global" | "team";

function getStorageForScope(context: vscode.ExtensionContext, scope: FavScope): vscode.Memento {
  return scope === "global" ? context.globalState : context.workspaceState;
}

function getTeamFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  const cfg = vscode.workspace.getConfiguration("favLauncher").get<number | string>("teamWorkspaceFolder", 0);
  if (typeof cfg === "number") { return folders[cfg] ?? folders[0]; }
  return folders.find(f => f.name === cfg) ?? folders[0];
}

function loadItemsForScope(context: vscode.ExtensionContext, scope: FavScope): FavoriteItem[] {
  if (scope === "team") { return loadTeamItems(); }
  return getStorageForScope(context, scope).get<FavoriteItem[]>(STORAGE_KEY, []);
}

function loadTeamItems(): FavoriteItem[] {
  const folder = getTeamFolder();
  if (!folder) { return []; }
  const filePath = path.join(folder.uri.fsPath, TEAM_STORAGE_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FavoriteItem[];
  } catch { return []; }
}

async function saveItemsForScope(context: vscode.ExtensionContext, scope: FavScope, items: FavoriteItem[]): Promise<void> {
  if (scope === "team") {
    const folder = getTeamFolder();
    if (!folder) { return; }
    const filePath = path.join(folder.uri.fsPath, TEAM_STORAGE_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
    return;
  }
  await getStorageForScope(context, scope).update(STORAGE_KEY, items);
}

const SCOPES: FavScope[] = ["global", "workspace", "team"];
const VIEW_IDS: Record<FavScope, string> = {
  global: "favLauncher.globalView",
  workspace: "favLauncher.workspaceView",
  team: "favLauncher.teamView",
};

export function activate(context: vscode.ExtensionContext) {
  const itemsByScope: Record<FavScope, FavoriteItem[]> = {
    global: loadItemsForScope(context, "global"),
    workspace: loadItemsForScope(context, "workspace"),
    team: loadItemsForScope(context, "team"),
  };

  function getScopeForItem(itemId: string): FavScope | undefined {
    for (const scope of SCOPES) {
      if (itemsByScope[scope].some(x => x.id === itemId)) { return scope; }
    }
    return undefined;
  }

  async function resolveScope(scopeArg?: FavScope): Promise<FavScope | undefined> {
    if (scopeArg && SCOPES.includes(scopeArg)) { return scopeArg; }
    const defaultScope = vscode.workspace.getConfiguration("favLauncher").get<FavScope>("defaultAddScope", "workspace");
    if (SCOPES.includes(defaultScope)) { return defaultScope; }
    const picked = await vscode.window.showQuickPick(
      [
        { label: "$(globe) Global Favorites", scope: "global" as FavScope },
        { label: "$(root-folder) Workspace Favorites", scope: "workspace" as FavScope },
        { label: "$(organization) Team Favorites", scope: "team" as FavScope },
      ],
      { title: "Which list?" }
    );
    return picked?.scope;
  }

  type ScopeState = {
    get items(): FavoriteItem[];
    provider: FavoritesProvider;
    treeView: vscode.TreeView<FavoriteItem>;
    doRefresh: () => Promise<void>;
  };

  const providers: Record<FavScope, FavoritesProvider> = {} as Record<FavScope, FavoritesProvider>;
  const treeViews: Record<FavScope, vscode.TreeView<FavoriteItem>> = {} as Record<FavScope, vscode.TreeView<FavoriteItem>>;

  for (const scope of SCOPES) {
    const onReorder = async (draggedId: string, targetId: string | null, parentGroupId: string | undefined) => {
      const items = itemsByScope[scope];
      const draggedIdx = items.findIndex(x => x.id === draggedId);
      if (draggedIdx === -1) { return; }
      const dragged = { ...items[draggedIdx], groupId: parentGroupId };
      const next = items.filter(x => x.id !== draggedId);
      if (targetId === null) {
        const siblings = next.filter(x => x.groupId === parentGroupId);
        dragged.order = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) + 1 : 0;
        next.push(dragged);
      } else {
        const targetIdx = next.findIndex(x => x.id === targetId);
        if (targetIdx === -1) { return; }
        next.splice(targetIdx, 0, dragged);
        let order = 0;
        for (let i = 0; i < next.length; i++) {
          if (next[i].groupId === parentGroupId) { (next[i] as FavoriteItem).order = order++; }
        }
      }
      itemsByScope[scope] = next;
      await saveItemsForScope(context, scope, next);
      providers[scope].refresh();
    };

    const provider = new FavoritesProvider(
      () => itemsByScope[scope],
      onReorder
    );
    providers[scope] = provider;
    const treeView = vscode.window.createTreeView(VIEW_IDS[scope], {
      treeDataProvider: provider,
      dragAndDropController: provider,
      showCollapseAll: true,
    });
    treeViews[scope] = treeView;
    context.subscriptions.push(treeView);
  }

  function getState(scope: FavScope): ScopeState {
    const provider = providers[scope];
    const treeView = treeViews[scope];
    return {
      get items() { return itemsByScope[scope]; },
      provider,
      treeView,
      async doRefresh() {
        await saveItemsForScope(context, scope, itemsByScope[scope]);
        updateStatus();
        provider.refresh();
      },
    };
  }

  // ── Prompt helpers ──────────────────────────────────────────────────────────

  const resolvePromptTemplate = async (item: FavoriteItem): Promise<string | undefined> => {
    const template = item.promptTemplate ?? "";
    if (!template) {
      vscode.window.showWarningMessage("Prompt template is empty.");
      return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    const selectionText = editor ? editor.document.getText(editor.selection) : "";
    const filePath = editor?.document?.uri.fsPath;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let relativePath = "";
    if (filePath && workspaceFolder && filePath.startsWith(workspaceFolder)) {
      relativePath = filePath.slice(workspaceFolder.length).replace(/^[\\/]/, "");
    }

    const clipboardText = await vscode.env.clipboard.readText();

    // Collect distinct input prompts
    const inputRegex = /\$\{input(?::([^}]*))?\}/g;
    const prompts = new Map<string, string>(); // key -> question
    let m: RegExpExecArray | null;
    while ((m = inputRegex.exec(template)) !== null) {
      const label = (m[1] ?? "").trim();
      const key = label || "__generic__";
      if (!prompts.has(key)) {
        prompts.set(key, label || "Enter a value for ${input}");
      }
    }

    const answers = new Map<string, string>();
    for (const [key, question] of prompts.entries()) {
      const answer = await vscode.window.showInputBox({ title: "Prompt input", prompt: question });
      if (answer === undefined) { return undefined; }
      answers.set(key, answer);
    }

    const replaceFn = (match: string, p1?: string): string => {
      const token = match.slice(2, -1); // inside ${}
      if (token.startsWith("input")) {
        const label = (p1 ?? "").trim();
        const key = label || "__generic__";
        return answers.get(key) ?? "";
      }
      if (token === "selection") { return selectionText ?? ""; }
      if (token === "file") { return filePath ?? ""; }
      if (token === "relativePath") { return relativePath ?? ""; }
      if (token === "workspaceFolder") { return workspaceFolder ?? ""; }
      if (token === "clipboard") { return clipboardText ?? ""; }
      return match;
    };

    const resolved = template.replace(/\$\{input(?::([^}]*))?\}|\$\{selection\}|\$\{file\}|\$\{relativePath\}|\$\{workspaceFolder\}|\$\{clipboard\}/g, replaceFn);
    return resolved;
  };

  type PromptTarget = "codex" | "cursor" | "clipboard";

  const resolvePromptTarget = async (item: FavoriteItem): Promise<PromptTarget> => {
    let target = item.targetOverride;
    if (!target || target === "auto") {
      target = vscode.workspace.getConfiguration("favLauncher").get<"auto" | PromptTarget>("ai.defaultTarget", "auto");
    }
    if (target && target !== "auto") { return target as PromptTarget; }

    // Auto-detect based on available commands
    let commands: string[] = [];
    try {
      commands = await vscode.commands.getCommands(true);
    } catch { /* ignore */ }
    const hasCodex = commands.includes("chatgpt.openSidebar") || commands.includes("chatgpt.newChat");
    const hasCursor = commands.includes("composer.newAgentChat");
    if (hasCodex) { return "codex"; }
    if (hasCursor) { return "cursor"; }
    return "clipboard";
  };

  const sendPromptToCodex = async (prompt: string, paste: boolean) => {
    await vscode.env.clipboard.writeText(prompt);
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes("chatgpt.openSidebar")) {
      await vscode.commands.executeCommand("chatgpt.openSidebar");
    }
    if (commands.includes("chatgpt.newChat")) {
      await vscode.commands.executeCommand("chatgpt.newChat");
    }
    if (paste) {
      try {
        // Small delay so the chat input is ready for paste
        await new Promise(resolve => setTimeout(resolve, 250));
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      } catch {
        vscode.window.showInformationMessage("Prompt copied to clipboard. Paste it into Codex manually.");
        return;
      }
    } else {
      vscode.window.showInformationMessage("Prompt copied to clipboard for Codex.");
    }
  };

  const sendPromptToCursor = async (prompt: string, paste: boolean) => {
    await vscode.env.clipboard.writeText(prompt);
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes("composer.newAgentChat")) {
      await vscode.commands.executeCommand("composer.newAgentChat");
    }
    if (paste) {
      try {
        // Small delay so the chat input is ready for paste
        await new Promise(resolve => setTimeout(resolve, 250));
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      } catch {
        vscode.window.showInformationMessage("Prompt copied to clipboard. Paste it into Cursor manually.");
        return;
      }
    } else {
      vscode.window.showInformationMessage("Prompt copied to clipboard for Cursor.");
    }
  };

  const copyPromptToClipboard = async (prompt: string) => {
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage("Prompt copied to clipboard.");
  };

  const runPromptFavorite = async (item: FavoriteItem) => {
    const resolved = await resolvePromptTemplate(item);
    if (resolved === undefined) { return; }
    const target = await resolvePromptTarget(item);
    const autoPaste = vscode.workspace.getConfiguration("favLauncher").get<boolean>("ai.autoPaste", true);
    const paste = item.pasteAfterOpen ?? autoPaste;
    if (target === "codex") {
      await sendPromptToCodex(resolved, paste);
    } else if (target === "cursor") {
      await sendPromptToCursor(resolved, paste);
    } else {
      await copyPromptToClipboard(resolved);
    }
    const scope = getScopeForItem(item.id);
    if (!scope) { return; }
    const state = getState(scope);
    const idx = state.items.findIndex(x => x.id === item.id);
    if (idx !== -1) {
      state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
      await saveItemsForScope(context, scope, state.items);
    }
  };

  const copyResolvedPromptFavorite = async (item: FavoriteItem) => {
    const resolved = await resolvePromptTemplate(item);
    if (resolved === undefined) { return; }
    await copyPromptToClipboard(resolved);
  };


  // Status bar
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  statusItem.tooltip = "Open Favorites";
  statusItem.command = "favLauncher.open";
  statusItem.show();

  const updateStatus = () => {
    let count = 0;
    let deadLinks = 0;
    let files = 0, commands = 0, macros = 0, pinned = 0, groups = 0;
    for (const scope of SCOPES) {
      const items = itemsByScope[scope];
      const real = items.filter(x => x.type !== "group" && x.type !== "separator");
      count += real.length;
      deadLinks += providers[scope].countDeadLinks();
      files += real.filter(x => x.type === "file").length;
      commands += real.filter(x => x.type === "command").length;
      macros += real.filter(x => x.type === "macro").length;
      pinned += real.filter(x => x.pinned).length;
      groups += items.filter(x => x.type === "group").length;
    }
    statusItem.text = `$(star-full) Fav${count > 0 ? ` (${count})` : ""}${deadLinks > 0 ? ` $(warning)` : ""}`;
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
        const statusLetters: Record<number, string> = { 0: "?", 1: "A", 2: "D", 3: "M", 5: "M", 6: "R", 7: "C", 8: "U" };
        statusMap.set(fsPath, statusLetters[change.status] ?? "M");
      }
      for (const scope of SCOPES) { providers[scope].setGitStatus(statusMap); }
    } catch { /* git not available */ }
  };

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
    for (const scope of SCOPES) { providers[scope].setDirtyFiles(dirty); }
  };
  refreshDirtyFiles();
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => refreshDirtyFiles()));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => refreshDirtyFiles()));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(() => refreshDirtyFiles()));

  // Watch team file for changes
  let teamWatcher: vscode.FileSystemWatcher | undefined;
  const setupTeamWatcher = () => {
    teamWatcher?.dispose();
    const folder = getTeamFolder();
    if (folder) {
      const pattern = new vscode.RelativePattern(folder, TEAM_STORAGE_FILE);
      teamWatcher = vscode.workspace.createFileSystemWatcher(pattern);
      teamWatcher.onDidChange(() => {
        itemsByScope.team = loadItemsForScope(context, "team");
        updateStatus();
        providers.team.refresh();
      });
      context.subscriptions.push(teamWatcher);
    }
  };
  setupTeamWatcher();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("favLauncher.teamWorkspaceFolder")) {
      itemsByScope.team = loadItemsForScope(context, "team");
      setupTeamWatcher();
      updateStatus();
      providers.team.refresh();
    }
  }));

  // ── Run on startup ────────────────────────────────────────────────────────
  const runOnStartup = async () => {
    const cfg = vscode.workspace.getConfiguration("favLauncher");
    const startupId = cfg.get<string>("startupItemId", "");
    if (!startupId) { return; }
    let target: FavoriteItem | undefined;
    for (const scope of SCOPES) {
      target = itemsByScope[scope].find(x => x.id === startupId);
      if (target) { break; }
    }
    if (!target) { return; }
    // Small delay so the workspace is fully ready
    setTimeout(async () => {
      if (target.type === "file" && target.path) {
        await openFile(target.path);
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
      try {
        await vscode.commands.executeCommand("workbench.view.extension.favLauncherSidebar");
        await vscode.commands.executeCommand("favLauncher.workspaceView.focus");
      } catch { /* ignore */ }
    })
  );

  // Filter (applies to all three views)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.filterFavorites", async () => {
      const text = await vscode.window.showInputBox({
        title: "Filter Favorites",
        placeHolder: "Type to filter by name, path or note… (leave blank to clear)",
        value: "",
      });
      if (text === undefined) { return; }
      const trimmed = text.trim();
      for (const scope of SCOPES) { providers[scope].setFilter(trimmed); }
      if (trimmed) {
        vscode.window.showInformationMessage(`Favorites filtered: "${trimmed}" — click Clear Filter to reset.`, "Clear Filter")
          .then(v => { if (v) { for (const s of SCOPES) { providers[s].setFilter(""); } } });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.clearFilter", () => {
      for (const scope of SCOPES) { providers[scope].setFilter(""); }
    })
  );

  async function pickGroup(scope: FavScope): Promise<string | undefined> {
    const items = itemsByScope[scope];
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

  // Add file
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addCurrentFile", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: "Add to Favorites",
        title: "Pick workspace files or folders to favorite",
        defaultUri: workspaceRoot,
      });
      if (!uris || uris.length === 0) { return; }
      await addFileUris(uris, scope);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addFromExplorer", async (uri?: vscode.Uri, allUris?: vscode.Uri[], scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const urisToAdd = allUris && allUris.length > 0 ? allUris : uri ? [uri] : undefined;
      if (!urisToAdd) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        await addFileUris([editor.document.uri], scope);
        return;
      }
      await addFileUris(urisToAdd, scope);
    })
  );

  async function addFileUris(uris: vscode.Uri[], scope: FavScope) {
    const state = getState(scope);
    const items = state.items;
    const groupId = await pickGroup(scope);
    const newUris = uris.filter(u => !items.some(x => x.type === "file" && x.path === u.fsPath));
    const skipped = uris.length - newUris.length;
    if (newUris.length === 0) { vscode.window.showInformationMessage("All selected items are already in Favorites."); return; }

    if (newUris.length === 1) {
      const fsPath = newUris[0].fsPath;
      const defaultLabel = fsPath.split(/[\\/]/).pop() ?? fsPath;
      const label = (await vscode.window.showInputBox({ title: "Label", value: defaultLabel, prompt: "Give it a friendly name" })) ?? defaultLabel;
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      itemsByScope[scope] = [...items, { id: newId(), type: "file", label, path: fsPath, order: maxOrder + 1, groupId }];
    } else {
      let nextOrder = items.filter(x => x.groupId === groupId).length > 0
        ? Math.max(...items.filter(x => x.groupId === groupId).map(x => x.order)) + 1 : 0;
      itemsByScope[scope] = [...items, ...newUris.map(u => ({
        id: newId(), type: "file" as const,
        label: u.fsPath.split(/[\\/]/).pop() ?? u.fsPath,
        path: u.fsPath, order: nextOrder++, groupId,
      }))];
    }
    await state.doRefresh();
    const msg = newUris.length === 1
      ? `Added "${newUris[0].fsPath.split(/[\\/]/).pop()}" to Favorites.`
      : `Added ${newUris.length} items to Favorites.${skipped > 0 ? ` (${skipped} already existed)` : ""}`;
    vscode.window.showInformationMessage(msg);
  }

  // Add command
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addCommand", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
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
      const groupId = await pickGroup(scope);
      const label = (await vscode.window.showInputBox({ title: "Label", value: defaultLabel })) ?? defaultLabel;
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      itemsByScope[scope] = [...items, { id: newId(), type: "command", label, commandId, order: maxOrder + 1, groupId }];
      await state.doRefresh();
    })
  );

  // Add macro
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addMacro", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
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
      const groupId = await pickGroup(scope);
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      itemsByScope[scope] = [...items, { id: newId(), type: "macro", label, macroSteps, order: maxOrder + 1, groupId }];
      await state.doRefresh();
    })
  );

  // Run macro
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.runMacro", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const steps: MacroStep[] = node.macroSteps ??
        (node.macroCommands ?? []).map(c => ({ kind: "command" as const, commandId: c }));
      let terminal: vscode.Terminal | undefined;
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) {
        state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
        await saveItemsForScope(context, scope, state.items);
      }
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
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "macro") { return; }
      const state = getState(scope);
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
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) {
        state.items[idx] = { ...state.items[idx], macroSteps: edited, macroCommands: undefined };
        await state.doRefresh();
      }
    })
  );

  // Add separator
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addSeparator", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const separatorLabel = await vscode.window.showInputBox({
        title: "Separator label (optional)",
        placeHolder: "e.g. Work, Personal — leave blank for a plain line",
      });
      if (separatorLabel === undefined) { return; } // cancelled
      const groupId = await pickGroup(scope);
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      itemsByScope[scope] = [...items, {
        id: newId(), type: "separator", label: "---",
        separatorLabel: separatorLabel.trim() || undefined,
        order: maxOrder + 1, groupId,
      }];
      await state.doRefresh();
    })
  );

  // Add group
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addGroup", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const label = await vscode.window.showInputBox({ title: "Group name", placeHolder: "e.g. Work" });
      if (!label) { return; }
      const maxOrder = items.filter(x => !x.groupId).length > 0
        ? Math.max(...items.filter(x => !x.groupId).map(x => x.order)) : -1;
      itemsByScope[scope] = [...items, { id: newId(), type: "group", label, order: maxOrder + 1 }];
      await state.doRefresh();
    })
  );

  // Add prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addPrompt", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const autoPaste = cfg.get<boolean>("ai.autoPaste", true);

      const picks = PROMPT_TEMPLATES.map(template => ({
        label: template.label,
        description: template.description,
        template,
      }));

      const picked = await vscode.window.showQuickPick(
        picks,
        {
          title: "Choose Prompt Template",
          matchOnDescription: true,
          placeHolder: "Select a starter template for your new prompt",
        }
      ) as (vscode.QuickPickItem & { template: PromptTemplate }) | undefined;

      if (!picked) { return; }

      const chosen = picked.template;
      const starter = chosen.starter;

      const groupId = await pickGroup(scope);
      const siblings = items.filter(x => x.groupId === groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      const newItem: FavoriteItem = {
        id: newId(),
        type: "prompt",
        label: starter.label,
        order: maxOrder + 1,
        groupId,
        promptTemplate: starter.promptTemplate,
        targetOverride: starter.targetOverride ?? "auto",
        pasteAfterOpen: starter.pasteAfterOpen ?? autoPaste,
        note: starter.note || undefined,
      };
      itemsByScope[scope] = [...items, newItem];
      await state.doRefresh();
      vscode.window.showInformationMessage(`Added prompt "${newItem.label}" from template "${chosen.label}".`);

      // Prefer the richer JSON editor flow if available
      try {
        await vscode.commands.executeCommand("favLauncher.editPromptJson", newItem);
      } catch {
        // Fallback: do nothing if the command is unavailable
      }
    })
  );

  // Rename
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.renameItem", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      if (node.type === "separator") {
        await vscode.commands.executeCommand("favLauncher.editSeparatorLabel", node);
        return;
      }
      const label = await vscode.window.showInputBox({ title: "Rename", value: node.label });
      if (!label) { return; }
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], label }; await state.doRefresh(); }
    })
  );

  // Run prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.runPrompt", async (node: FavoriteItem) => {
      if (node.type !== "prompt") { return; }
      await runPromptFavorite(node);
    })
  );

  // Copy resolved prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.copyResolvedPrompt", async (node: FavoriteItem) => {
      if (node.type !== "prompt") { return; }
      await copyResolvedPromptFavorite(node);
    })
  );

  // Edit prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editPrompt", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "prompt") { return; }
      const state = getState(scope);
      const newLabel = await vscode.window.showInputBox({ title: "Prompt name", value: node.label });
      if (newLabel === undefined) { return; }
      const newTemplate = await vscode.window.showInputBox({
        title: "Prompt template",
        value: node.promptTemplate ?? "",
        prompt: "Use ${input}, ${input:Label}, ${selection}, ${file}, ${relativePath}, ${workspaceFolder}, ${clipboard}",
      });
      if (newTemplate === undefined) { return; }
      const currentOverride = node.targetOverride ?? "auto";
      const targetPick = await vscode.window.showQuickPick([
        { label: "Auto", description: "auto", picked: currentOverride === "auto" },
        { label: "Codex", description: "codex", picked: currentOverride === "codex" },
        { label: "Cursor", description: "cursor", picked: currentOverride === "cursor" },
        { label: "Clipboard", description: "clipboard", picked: currentOverride === "clipboard" },
      ], { title: "Prompt destination" });
      if (!targetPick) { return; }
      const pastePick = await vscode.window.showQuickPick(
        [
          { label: "Yes — paste into chat after opening", description: "true" },
          { label: "No — just open chat with prompt on clipboard", description: "false" },
        ],
        { title: "Auto-paste prompt into chat?", canPickMany: false }
      );
      if (!pastePick) { return; }
      const pasteAfterOpen = pastePick.description === "true";
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) {
        state.items[idx] = {
          ...state.items[idx],
          label: newLabel || node.label,
          promptTemplate: newTemplate ?? "",
          targetOverride: targetPick.description as any,
          pasteAfterOpen,
        };
        await state.doRefresh();
      }
    })
  );

  // Edit prompt as JSON/text in the editor
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editPromptJson", async (node: FavoriteItem) => {
      if (node.type !== "prompt") { return; }

      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const defaultAutoPaste = cfg.get<boolean>("ai.autoPaste", true);

      const template = {
        label: node.label,
        note: node.note ?? "",
        promptTemplate: node.promptTemplate ?? "",
        targetOverride: node.targetOverride ?? "auto",
        pasteAfterOpen: node.pasteAfterOpen ?? defaultAutoPaste,
      };

      const helpComment = [
        "// Edit your prompt below and save (Ctrl+S) to apply.",
        "// Fields:",
        '//   label           — name shown in the Favorites list.',
        '//   note            — optional note/description (shown in tooltip and/or inline).',
        '//   promptTemplate  — the actual prompt text. Supports tokens:',
        '//                      ${input}, ${input:Label}, ${selection}, ${file},',
        '//                      ${relativePath}, ${workspaceFolder}, ${clipboard}',
        '//   targetOverride  — \"auto\" | \"codex\" | \"cursor\" | \"clipboard\".',
        '//   pasteAfterOpen  — true to auto-paste into chat after opening.',
        "//",
        "// Do NOT remove the outer object. If JSON is invalid, changes will not be applied.",
        "",
      ].join("\n");

      const content = helpComment + JSON.stringify(template, null, 2);
      const os = require("os");
      const tmpPath = path.join(os.tmpdir(), `prompt-${node.id}.jsonc`);
      fs.writeFileSync(tmpPath, content, "utf8");
      const uri = vscode.Uri.file(tmpPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });

      const disposable = vscode.workspace.onDidSaveTextDocument(async saved => {
        if (saved.uri.toString() !== doc.uri.toString()) { return; }
        const text = saved.getText().split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
        try {
          const parsed = JSON.parse(text);
          const newLabelRaw = parsed.label ?? node.label;
          const newLabel = typeof newLabelRaw === "string" && newLabelRaw.trim()
            ? newLabelRaw.trim()
            : node.label;
          const newNoteRaw = parsed.note ?? "";
          const newNote = typeof newNoteRaw === "string" && newNoteRaw.trim()
            ? newNoteRaw.trim()
            : undefined;
          const newTemplateRaw = parsed.promptTemplate ?? "";
          const newTemplate = typeof newTemplateRaw === "string" ? newTemplateRaw : "";
          let newTarget: any = parsed.targetOverride ?? node.targetOverride ?? "auto";
          if (!["auto", "codex", "cursor", "clipboard"].includes(newTarget)) {
            newTarget = "auto";
          }
          const newPaste = typeof parsed.pasteAfterOpen === "boolean"
            ? parsed.pasteAfterOpen
            : (node.pasteAfterOpen ?? defaultAutoPaste);

          const scope = getScopeForItem(node.id);
          if (scope) {
            const state = getState(scope);
            const i = state.items.findIndex(x => x.id === node.id);
            if (i !== -1) {
              state.items[i] = {
                ...state.items[i],
                label: newLabel,
                note: newNote,
                promptTemplate: newTemplate,
                targetOverride: newTarget,
                pasteAfterOpen: newPaste,
              };
              await state.doRefresh();
            }
          }
          vscode.window.showInformationMessage(`Prompt "${newLabel}" saved.`);
          disposable.dispose();
          try { fs.unlinkSync(tmpPath); } catch { }
        } catch {
          vscode.window.showErrorMessage("Invalid JSON — prompt not saved. Fix the syntax and save again.");
        }
      });
      context.subscriptions.push(disposable);
    })
  );

  // Clone prompt
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.clonePrompt", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "prompt") { return; }
      const state = getState(scope);
      const items = state.items;
      const siblings = items.filter(x => x.groupId === node.groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      const clone: FavoriteItem = {
        ...node,
        id: newId(),
        label: `${node.label} (copy)`,
        order: maxOrder + 1,
        pinned: false,
        lastUsed: undefined,
      };
      itemsByScope[scope] = [...items, clone];
      await state.doRefresh();
      vscode.window.showInformationMessage(`Cloned prompt "${node.label}".`);
    })
  );

  // Pin / Unpin
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.pinItem", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], pinned: true }; await state.doRefresh(); }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.unpinItem", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], pinned: false }; await state.doRefresh(); }
    })
  );

  // Move to group
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.moveToGroup", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const groupId = await pickGroup(scope);
      const siblings = state.items.filter(x => x.groupId === groupId && x.id !== node.id);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], groupId, order: maxOrder + 1 }; await state.doRefresh(); }
    })
  );

  // Duplicate
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.duplicateItem", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const siblings = items.filter(x => x.groupId === node.groupId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(x => x.order)) : -1;
      const dupe: FavoriteItem = { ...node, id: newId(), label: `${node.label} (copy)`, order: maxOrder + 1, pinned: false };
      itemsByScope[scope] = [...items, dupe];
      await state.doRefresh();
    })
  );

  // Move to another list (Global / Workspace / Team)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.moveToScope", async (node: FavoriteItem, targetScopeArg?: FavScope) => {
      const sourceScope = getScopeForItem(node.id);
      if (!sourceScope) { return; }
      const otherScopes = SCOPES.filter(s => s !== sourceScope);
      if (otherScopes.length === 0) { return; }
      let targetScope: FavScope;
      if (targetScopeArg && targetScopeArg !== sourceScope) {
        targetScope = targetScopeArg;
      } else {
        const picked = await vscode.window.showQuickPick(
          otherScopes.map(s => ({
            label: s === "global" ? "$(globe) Global Favorites" : s === "team" ? "$(organization) Team Favorites" : "$(root-folder) Workspace Favorites",
            scope: s,
          })),
          { title: "Move to which list?" }
        );
        if (!picked) { return; }
        targetScope = picked.scope;
      }
      const sourceState = getState(sourceScope);
      const targetState = getState(targetScope);
      const sourceItems = sourceState.items;
      const idsToMove = node.type === "group"
        ? [node.id, ...sourceItems.filter(x => x.groupId === node.id).map(x => x.id)]
        : [node.id];
      const toMove = sourceItems.filter(x => idsToMove.includes(x.id));
      if (toMove.length === 0) { return; }
      const groupId = await pickGroup(targetScope);
      const targetItems = targetState.items;
      const maxOrder = targetItems.length > 0 ? Math.max(...targetItems.map(x => x.order ?? 0)) : -1;
      const withOrder = toMove.map((x, i) => ({ ...x, order: maxOrder + 1 + i, groupId: x.id === node.id ? groupId : (x.groupId === node.id ? node.id : x.groupId) }));
      itemsByScope[sourceScope] = sourceItems.filter(x => !idsToMove.includes(x.id));
      itemsByScope[targetScope] = [...targetItems, ...withOrder];
      await sourceState.doRefresh();
      await targetState.doRefresh();
      vscode.window.showInformationMessage(`Moved to ${targetScope} favorites.`);
    })
  );

  // Copy to another list (Global / Workspace / Team)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.copyToScope", async (node: FavoriteItem, targetScopeArg?: FavScope) => {
      const sourceScope = getScopeForItem(node.id);
      if (!sourceScope) { return; }
      let targetScope: FavScope | undefined = targetScopeArg;
      if (!targetScope) {
        const picked = await vscode.window.showQuickPick(
          SCOPES.map(s => ({
            label: s === "global" ? "$(globe) Global Favorites" : s === "team" ? "$(organization) Team Favorites" : "$(root-folder) Workspace Favorites",
            scope: s,
          })),
          { title: "Copy to which list?" }
        );
        if (!picked) { return; }
        targetScope = picked.scope;
      }
      const targetState = getState(targetScope);
      const sourceItems = getState(sourceScope).items;
      const groupId = await pickGroup(targetScope);
      const targetItems = targetState.items;
      const maxOrder = targetItems.length > 0 ? Math.max(...targetItems.map(x => x.order ?? 0)) : -1;
      if (node.type === "group") {
        const newGroupId = newId();
        const children = sourceItems.filter(x => x.groupId === node.id);
        const newGroup: FavoriteItem = { ...node, id: newGroupId, order: maxOrder + 1, groupId };
        const newChildren: FavoriteItem[] = children.map((x, i) => ({ ...x, id: newId(), groupId: newGroupId, order: maxOrder + 2 + i }));
        itemsByScope[targetScope] = [...targetItems, newGroup, ...newChildren];
      } else {
        const clone: FavoriteItem = { ...node, id: newId(), order: maxOrder + 1, groupId, pinned: false };
        itemsByScope[targetScope] = [...targetItems, clone];
      }
      await targetState.doRefresh();
      vscode.window.showInformationMessage(`Copied to ${targetScope} favorites.`);
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
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
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
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], icon }; await state.doRefresh(); }
    })
  );

  // Add / Edit note
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editNote", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const note = await vscode.window.showInputBox({
        title: node.note ? "Edit Note" : "Add Note",
        value: node.note ?? "",
        prompt: "Leave blank to remove the note",
        placeHolder: "e.g. Main entry point, run before deploying...",
      });
      if (note === undefined) { return; }
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], note: note.trim() || undefined }; await state.doRefresh(); }
    })
  );

  // Edit macro steps (alias shown in menu)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editMacroAlias", (node: FavoriteItem) =>
      vscode.commands.executeCommand("favLauncher.editMacro", node)
    )
  );

  // Edit macro as JSON in the editor
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editMacroJson", async (node: FavoriteItem) => {
      if (node.type !== "macro") { return; }

      const steps: MacroStep[] = node.macroSteps ??
        (node.macroCommands ?? []).map(c => ({ kind: "command" as const, commandId: c }));

      const template = {
        label: node.label,
        note: node.note ?? "",
        steps,
      };

      const helpComment = [
        "// Edit your macro below and save (Ctrl+S) to apply.",
        "// Each step is either:",
        '//   { "kind": "command",  "commandId": "editor.action.formatDocument" }',
        '//   { "kind": "terminal", "text": "npm run build" }',
        "// Reorder, add, or remove steps freely. Do NOT change the outer format.",
        "",
      ].join("\n");

      const content = helpComment + JSON.stringify(template, null, 2);
      // Write to OS temp dir to avoid permission issues on Windows
      const os = require("os");
      const tmpPath = path.join(os.tmpdir(), `macro-${node.id}.jsonc`);
      fs.writeFileSync(tmpPath, content, "utf8");
      const uri = vscode.Uri.file(tmpPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });

      // Watch for save on this document
      const disposable = vscode.workspace.onDidSaveTextDocument(async saved => {
        if (saved.uri.toString() !== doc.uri.toString()) { return; }
        // Strip only lines that are purely comments (start with optional whitespace then //)
        const text = saved.getText().split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
        try {
          const parsed = JSON.parse(text);
          const newSteps: MacroStep[] = (parsed.steps ?? []).filter((s: any) =>
            (s.kind === "command" && s.commandId) || (s.kind === "terminal" && s.text)
          );
          if (newSteps.length === 0) {
            vscode.window.showWarningMessage("Macro needs at least one step — not saved.");
            return;
          }
          const newLabel = (parsed.label ?? node.label).toString().trim() || node.label;
          const newNote = (parsed.note ?? "").toString().trim() || undefined;
          const scope = getScopeForItem(node.id);
          if (scope) {
            const state = getState(scope);
            const i = state.items.findIndex(x => x.id === node.id);
            if (i !== -1) {
              state.items[i] = { ...state.items[i], label: newLabel, note: newNote, macroSteps: newSteps, macroCommands: undefined };
              await state.doRefresh();
            }
          }
          vscode.window.showInformationMessage(`Macro "${newLabel}" saved (${newSteps.length} step${newSteps.length !== 1 ? "s" : ""}).`);
          disposable.dispose();
          // Clean up temp file
          try { fs.unlinkSync(tmpPath); } catch { }
        } catch (e) {
          vscode.window.showErrorMessage(`Invalid JSON — macro not saved. Fix the syntax and save again.`);
        }
      });
      context.subscriptions.push(disposable);
    })
  );

  // Reveal folder in explorer
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.revealInExplorer", async (nodeOrUri: FavoriteItem | vscode.Uri) => {
      let fsPath: string;
      if (nodeOrUri instanceof vscode.Uri) {
        fsPath = nodeOrUri.fsPath;
      } else {
        const node = nodeOrUri as FavoriteItem;
        fsPath = node.path ?? "";
        const scope = getScopeForItem(node.id);
        if (scope) {
          const state = getState(scope);
          const idx = state.items.findIndex(x => x.id === node.id);
          if (idx !== -1) {
            state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
            await saveItemsForScope(context, scope, state.items);
          }
        }
      }

      if (!fsPath) { return; }

      const uri = vscode.Uri.file(fsPath);

      // Check if the folder is inside any workspace folder
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const isInsideWorkspace = workspaceFolders.some(wf =>
        fsPath === wf.uri.fsPath || fsPath.startsWith(wf.uri.fsPath + path.sep)
      );

      if (isInsideWorkspace) {
        // Reveal in the Explorer sidebar
        await vscode.commands.executeCommand("revealInExplorer", uri);
      } else {
        // Outside workspace — offer to open in new window or add to workspace
        const action = await vscode.window.showInformationMessage(
          `"${path.basename(fsPath)}" is outside the current workspace.`,
          "Open in New Window",
          "Add to Workspace"
        );
        if (action === "Open in New Window") {
          await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
        } else if (action === "Add to Workspace") {
          const currentCount = workspaceFolders.length;
          vscode.workspace.updateWorkspaceFolders(currentCount, 0, { uri });
        }
      }
    })
  );

  // Open in current window — focus existing tab if already open
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openInCurrentWindow", async (node: FavoriteItem) => {
      if (node.type !== "file" || !node.path) { return; }
      const scope = getScopeForItem(node.id);
      if (scope) {
        const state = getState(scope);
        const idx = state.items.findIndex(x => x.id === node.id);
        if (idx !== -1) {
          state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
          await saveItemsForScope(context, scope, state.items);
        }
      }
      await openFile(node.path);
    })
  );

  // Open to side — always opens beside (intentional duplicate)
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openToSide", async (node: FavoriteItem) => {
      if (node.type !== "file" || !node.path) { return; }
      const scope = getScopeForItem(node.id);
      if (scope) {
        const state = getState(scope);
        const idx = state.items.findIndex(x => x.id === node.id);
        if (idx !== -1) {
          state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
          await saveItemsForScope(context, scope, state.items);
        }
      }
      await openFile(node.path, true);
    })
  );

  // Remove with undo
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeItem", async (node: FavoriteItem) => {
      if (!node) { return; }
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const removed = node.type === "group"
        ? items.filter(x => x.id === node.id || x.groupId === node.id)
        : items.filter(x => x.id === node.id);
      const next = node.type === "group"
        ? items.filter(x => x.id !== node.id && x.groupId !== node.id)
        : items.filter(x => x.id !== node.id);
      itemsByScope[scope] = next;
      await state.doRefresh();
      const action = await vscode.window.showInformationMessage(
        `Removed "${node.label}".`, "Undo"
      );
      if (action === "Undo") {
        itemsByScope[scope] = [...next, ...removed];
        await state.doRefresh();
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
      for (const s of SCOPES) { providers[s].refresh(); }
    })
  );

  // Export
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.exportFavorites", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultFilename = `favorites-${scope}.json`;
      const defaultUri = defaultFolder
        ? vscode.Uri.joinPath(defaultFolder, defaultFilename)
        : vscode.Uri.file(path.join(require("os").homedir(), defaultFilename));
      const uri = await vscode.window.showSaveDialog({
        filters: { JSON: ["json"] },
        saveLabel: "Export Favorites",
        defaultUri,
      });
      if (!uri) { return; }
      try {
        fs.writeFileSync(uri.fsPath, JSON.stringify(items, null, 2), "utf8");
        await context.globalState.update("favLauncher.lastBackupMs", Date.now());
        vscode.window.showInformationMessage(
          `Exported ${items.length} item${items.length !== 1 ? "s" : ""} from ${scope} scope to ${path.basename(uri.fsPath)}.`
        );
      } catch (e: any) {
        vscode.window.showErrorMessage(`Export failed: ${e?.message ?? "unknown error"}`);
      }
    })
  );

  // Import
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.importFavorites", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;

      const uris = await vscode.window.showOpenDialog({
        filters: { JSON: ["json"] },
        openLabel: "Import Favorites",
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
      });
      if (!uris || uris.length === 0) { return; }

      // 2. Read and parse
      const filePath = uris[0].fsPath;
      const filename = path.basename(filePath);
      let imported: FavoriteItem[];
      try {
        let text: string;
        try {
          text = fs.readFileSync(filePath, "utf8");
        } catch {
          const raw = await vscode.workspace.fs.readFile(uris[0]);
          text = Buffer.from(raw).toString("utf8");
        }
        if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
        const parsed = JSON.parse(text);
        imported = Array.isArray(parsed) ? parsed
          : Array.isArray(parsed?.items) ? parsed.items
          : (() => { throw new Error("File must contain a JSON array of favorites"); })();
        if (imported.length === 0) {
          vscode.window.showWarningMessage(`"${filename}" contains no items.`);
          return;
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Import failed: ${e?.message ?? "invalid JSON"}`);
        return;
      }

      // 3. If list is currently empty, load all directly with fresh IDs
      if (items.length === 0) {
        const maxOrder = -1;
        itemsByScope[scope] = imported.map((x, i) => ({ ...x, id: newId(), order: maxOrder + 1 + i }));
        await state.doRefresh();
        vscode.window.showInformationMessage(`Loaded ${itemsByScope[scope].length} item${itemsByScope[scope].length !== 1 ? "s" : ""} from ${filename}.`);
        return;
      }

      // 4. Compute what's new vs already present
      // Duplicate = same file path, same commandId, or same label+type for groups/macros/separators
      const isDupe = (x: FavoriteItem): boolean => {
        if (x.type === "file" && x.path) {
          return items.some(e => e.type === "file" && e.path === x.path);
        }
        if (x.type === "command" && x.commandId) {
          return items.some(e => e.type === "command" && e.commandId === x.commandId);
        }
        // For groups, macros, separators, workspaces — match by label+type
        return items.some(e => e.type === x.type && e.label === x.label);
      };

      const toAdd    = imported.filter(x => !isDupe(x));
      const skipped  = imported.length - toAdd.length;

      // 5. Ask: Merge (skip dupes) or Replace all
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: `$(add) Merge`,
            description: `add ${toAdd.length} new, skip ${skipped} duplicate${skipped !== 1 ? "s" : ""}`,
            value: "merge" as const,
          },
          {
            label: `$(replace-all) Replace all`,
            description: `discard current ${items.length} item${items.length !== 1 ? "s" : ""} and load all ${imported.length} from file`,
            value: "replace" as const,
          },
        ],
        { title: `Import "${filename}" — ${imported.length} item${imported.length !== 1 ? "s" : ""}` }
      );
      if (!choice) { return; }

      if (choice.value === "replace") {
        itemsByScope[scope] = imported.map((x, i) => ({ ...x, id: newId(), order: i }));
        await state.doRefresh();
        vscode.window.showInformationMessage(`Replaced favorites with ${itemsByScope[scope].length} item${itemsByScope[scope].length !== 1 ? "s" : ""} from ${filename}.`);
      } else {
        if (toAdd.length === 0) {
          vscode.window.showInformationMessage(`Nothing to import — all ${imported.length} item${imported.length !== 1 ? "s" : ""} already exist.`);
          return;
        }
        const maxOrder = items.length > 0 ? Math.max(...items.map(x => x.order ?? 0)) : -1;
        const appended = toAdd.map((x, i) => ({ ...x, id: newId(), order: maxOrder + 1 + i }));
        itemsByScope[scope] = [...items, ...appended];
        await state.doRefresh();
        vscode.window.showInformationMessage(
          `Added ${appended.length} new item${appended.length !== 1 ? "s" : ""}${skipped > 0 ? `. Skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}` : ""}.`
        );
      }
    })
  );

  // Open settings
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openSettings", async () => {
      try {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:kohrock.fav-launcher");
      } catch {
        await vscode.commands.executeCommand("workbench.action.openSettings", "favLauncher");
      }
    })
  );

  // Scroll to current file in panel
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.revealCurrentFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const fsPath = editor.document.uri.fsPath;
      let match: FavoriteItem | undefined;
      let matchScope: FavScope | undefined;
      for (const scope of SCOPES) {
        match = itemsByScope[scope].find(x => x.type === "file" && x.path === fsPath);
        if (match) { matchScope = scope; break; }
      }
      if (!match || !matchScope) {
        vscode.window.showInformationMessage("Current file is not in Favorites.");
        return;
      }
      await vscode.commands.executeCommand(VIEW_IDS[matchScope] + ".focus");
      treeViews[matchScope].reveal(match, { select: true, focus: true });
    })
  );

  // Auto-reveal current file when editor changes (if setting enabled)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) { return; }
      const autoReveal = vscode.workspace.getConfiguration("favLauncher").get<boolean>("autoRevealCurrentFile", false);
      if (!autoReveal) { return; }
      const fsPath = editor.document.uri.fsPath;
      for (const scope of SCOPES) {
        const match = itemsByScope[scope].find(x => x.type === "file" && x.path === fsPath);
        if (match) { treeViews[scope].reveal(match, { select: true, focus: false }); break; }
      }
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
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const confirm = await vscode.window.showWarningMessage(
        `Reset icon and color for "${node.label}"?`,
        { modal: true },
        "Reset"
      );
      if (confirm !== "Reset") { return; }
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], icon: undefined, color: undefined }; await state.doRefresh(); }
    })
  );

  // Reset all icons & colors on all items
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.resetAllStyles", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset all custom icons and colors?",
        {
          modal: true,
          detail: "This will remove every custom icon and color label from all your favorites. This cannot be undone.",
        },
        "Reset All"
      );
      if (confirm !== "Reset All") { return; }
      for (const scope of SCOPES) {
        itemsByScope[scope] = itemsByScope[scope].map(x => ({ ...x, icon: undefined, color: undefined }));
        await saveItemsForScope(context, scope, itemsByScope[scope]);
        providers[scope].refresh();
      }
      updateStatus();
      vscode.window.showInformationMessage("All icons and colors have been reset.");
    })
  );

  // Reset all settings to defaults
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.resetAllSettings", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset all Fav Launcher settings to defaults?",
        {
          modal: true,
          detail: "This resets sort order, display options, compact mode, backup reminder, and all other settings. Your favorites are not affected.",
        },
        "Reset All Settings"
      );
      if (confirm !== "Reset All Settings") { return; }

      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const keys = [
        "noteDisplay", "itemDescription", "sortOrder",
        "compactMode", "autoRevealCurrentFile", "backupReminderDays",
        "showRecentSection", "startupItemId",
      ];
      for (const key of keys) {
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      }

      for (const s of SCOPES) { providers[s].refresh(); }
      vscode.window.showInformationMessage("Fav Launcher settings reset to defaults.");
    })
  );

  // Clear all favorites in chosen scope
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.clearAllFavorites", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const count = state.items.length;
      if (count === 0) {
        vscode.window.showInformationMessage("Favorites list is already empty.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete all ${count} favorite${count !== 1 ? "s" : ""} in ${scope} scope?`,
        {
          modal: true,
          detail: "All favorites, groups, macros, and separators in this scope will be permanently removed. This cannot be undone.",
        },
        "Delete All"
      );
      if (confirm !== "Delete All") { return; }
      itemsByScope[scope] = [];
      await state.doRefresh();
      vscode.window.showInformationMessage(`Cleared all favorites in ${scope} scope.`);
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
      const scope = getScopeForItem(node.id);
      if (!scope) { return; }
      const state = getState(scope);
      const picked = await vscode.window.showQuickPick(
        COLORS.map(c => ({ label: COLOR_LABELS[c], description: c, picked: node.color === c })),
        { title: "Set color label" }
      );
      if (!picked) { return; }
      const color = picked.description === "none" ? undefined : picked.description;
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], color }; await state.doRefresh(); }
    })
  );

  // Quick launch Ctrl+1 through Ctrl+9 (pinned items across all scopes, ordered by scope then order)
  for (let i = 1; i <= 9; i++) {
    const idx = i - 1;
    context.subscriptions.push(
      vscode.commands.registerCommand(`favLauncher.launchPinned${i}`, async () => {
        const pinned: FavoriteItem[] = [];
        for (const scope of SCOPES) {
          pinned.push(...itemsByScope[scope].filter(x => x.pinned && x.type !== "group" && x.type !== "separator"));
        }
        pinned.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const target = pinned[idx];
        if (!target) {
          vscode.window.showInformationMessage(`No pinned favorite #${i}. Pin items to use Ctrl+${i}.`);
          return;
        }
        const scope = getScopeForItem(target.id);
        if (scope) {
          const state = getState(scope);
          const iidx = state.items.findIndex(x => x.id === target.id);
          if (iidx !== -1) {
            state.items[iidx] = { ...state.items[iidx], lastUsed: Date.now() };
            await saveItemsForScope(context, scope, state.items);
          }
        }
        if (target.type === "file" && target.path) {
          await openFile(target.path);
        } else if (target.type === "command" && target.commandId) {
          await vscode.commands.executeCommand(target.commandId, ...(target.args ?? []));
        } else if (target.type === "macro") {
          await vscode.commands.executeCommand("favLauncher.runMacro", target);
        }
      })
    );
  }

  // Config change handler
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration("favLauncher.noteDisplay") ||
        e.affectsConfiguration("favLauncher.itemDescription") ||
        e.affectsConfiguration("favLauncher.sortOrder") ||
        e.affectsConfiguration("favLauncher.compactMode")
      ) {
        for (const s of SCOPES) { providers[s].refresh(); }
      }
    })
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  // ── Quick add from clipboard ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.addFromClipboard", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const text = await vscode.env.clipboard.readText();
      if (!text?.trim()) {
        vscode.window.showWarningMessage("Clipboard is empty.");
        return;
      }
      const trimmed = text.trim();
      const looksLikePath = /^[a-zA-Z]:[/\\]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || fs.existsSync(trimmed);
      const type = looksLikePath ? "file" : "command";

      const label = await vscode.window.showInputBox({
        title: "Add from clipboard",
        prompt: `Label for "${trimmed.slice(0, 60)}"`,
        value: path.basename(trimmed) || trimmed.slice(0, 30),
      });
      if (label === undefined) { return; }

      const groupId = await pickGroup(scope);
      const newItem: FavoriteItem = {
        id: newId(),
        type,
        label: label || path.basename(trimmed) || trimmed.slice(0, 30),
        order: items.length,
        groupId,
        ...(type === "file" ? { path: trimmed } : { commandId: trimmed }),
      };
      itemsByScope[scope] = [...items, newItem];
      await state.doRefresh();
      vscode.window.showInformationMessage(`Added "${newItem.label}" from clipboard.`);
    })
  );

  // ── Scan & remove dead links ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeDeadLinks", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
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
      itemsByScope[scope] = items.filter(x => !deadIds.has(x.id));
      await state.doRefresh();
      vscode.window.showInformationMessage(`Removed ${dead.length} dead link${dead.length > 1 ? "s" : ""}.`);
    })
  );

  // ── Remove duplicates ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.removeDuplicates", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
      const seen = new Set<string>();
      const dupes: FavoriteItem[] = [];
      for (const item of items) {
        const key = item.type === "file"
          ? `file:${item.path}`
          : item.type === "command"
            ? `cmd:${item.commandId}`
            : `other:${item.label}`;
        if (seen.has(key)) { dupes.push(item); } else { seen.add(key); }
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
      itemsByScope[scope] = items.filter(x => !dupeIds.has(x.id));
      await state.doRefresh();
      vscode.window.showInformationMessage(`Removed ${dupes.length} duplicate${dupes.length > 1 ? "s" : ""}.`);
    })
  );

  // ── Jump to group (quick pick) ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.jumpToGroup", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
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
        await treeViews[scope].reveal(group, { select: true, focus: true, expand: true });
      }
    })
  );

  // ── Open all files in a group ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openAllInGroup", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "group") { return; }
      const items = getState(scope).items;
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
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "group") { return; }
      const items = getState(scope).items;
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
    vscode.commands.registerCommand("favLauncher.addWorkspace", async (scopeArg?: FavScope) => {
      const scope = await resolveScope(scopeArg);
      if (!scope) { return; }
      const state = getState(scope);
      const items = state.items;
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
      const groupId = await pickGroup(scope);
      const newItem: FavoriteItem = {
        id: newId(), type: "workspace", label: label || defaultLabel,
        order: items.length, groupId, workspacePath: wsPath,
      };
      itemsByScope[scope] = [...items, newItem];
      await state.doRefresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openWorkspace", async (node: FavoriteItem) => {
      if (!node.workspacePath) { return; }
      const scope = getScopeForItem(node.id);
      if (scope) {
        const state = getState(scope);
        const idx = state.items.findIndex(x => x.id === node.id);
        if (idx !== -1) {
          state.items[idx] = { ...state.items[idx], lastUsed: Date.now() };
          await saveItemsForScope(context, scope, state.items);
        }
      }
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
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "separator") { return; }
      const state = getState(scope);

      // If there's a label, offer to clear it or edit it
      if (node.separatorLabel) {
        const action = await vscode.window.showQuickPick(
          [
            { label: "$(edit) Edit label", id: "edit" },
            { label: "$(trash) Remove label (plain line)", id: "clear" },
          ],
          { title: `Separator: "${node.separatorLabel}"` }
        );
        if (!action) { return; }
        if ((action as any).id === "clear") {
          const idx = state.items.findIndex(x => x.id === node.id);
          if (idx !== -1) { state.items[idx] = { ...state.items[idx], separatorLabel: undefined }; await state.doRefresh(); }
          return;
        }
      }

      const label = await vscode.window.showInputBox({
        title: "Separator label (leave blank to remove)",
        value: node.separatorLabel ?? "",
        placeHolder: "e.g. Work, Personal, …",
      });
      if (label === undefined) { return; }
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], separatorLabel: label.trim() || undefined }; await state.doRefresh(); }
    })
  );

  // ── Edit command args ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.editArgs", async (node: FavoriteItem) => {
      const scope = getScopeForItem(node.id);
      if (!scope || node.type !== "command") { return; }
      const state = getState(scope);
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
      const idx = state.items.findIndex(x => x.id === node.id);
      if (idx !== -1) { state.items[idx] = { ...state.items[idx], args: newArgs }; await state.doRefresh(); }
      vscode.window.showInformationMessage(`Args updated for "${node.label}".`);
    })
  );

  // ── Toggle showRecentSection ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.toggleRecentSection", async () => {
      const cfg = vscode.workspace.getConfiguration("favLauncher");
      const current = cfg.get<boolean>("showRecentSection", false);
      await cfg.update("showRecentSection", !current, vscode.ConfigurationTarget.Global);
      for (const s of SCOPES) { providers[s].refresh(); }
      vscode.window.showInformationMessage(`Recent section ${!current ? "enabled" : "disabled"}.`);
    })
  );

  // ── Help / README ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("favLauncher.openHelp", async () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, "README.md");
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    })
  );
}

export function deactivate() {}
