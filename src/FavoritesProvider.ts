import * as vscode from "vscode";
import * as fs from "fs";
import { FavoriteItem, MIME_MOVE, SortOrder } from "./favoritesTypes";

export class FavoritesProvider
  implements
    vscode.TreeDataProvider<FavoriteItem>,
    vscode.TreeDragAndDropController<FavoriteItem>
{
  readonly dropMimeTypes = [MIME_MOVE];
  readonly dragMimeTypes = [MIME_MOVE];

  private _onDidChangeTreeData = new vscode.EventEmitter<FavoriteItem | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filterText: string = "";
  private gitStatus: Map<string, string> = new Map();
  private dirtyFiles: Set<string> = new Set(); // fsPath of files with unsaved changes

  constructor(
    private readonly getItems: () => FavoriteItem[],
    private readonly onReorder: (draggedId: string, targetId: string | null, parentGroupId: string | undefined) => Promise<void>
  ) {}

  setFilter(text: string) {
    this.filterText = text.toLowerCase();
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setGitStatus(statusMap: Map<string, string>) {
    this.gitStatus = statusMap;
    this._onDidChangeTreeData.fire();
  }

  setDirtyFiles(paths: Set<string>) {
    this.dirtyFiles = paths;
    this._onDidChangeTreeData.fire();
  }

  countDeadLinks(): number {
    return this.getItems().filter(x => x.type === "file" && x.path && !this.pathExists(x.path)).length;
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  handleDrag(source: readonly FavoriteItem[], dataTransfer: vscode.DataTransfer): void {
    dataTransfer.set(MIME_MOVE, new vscode.DataTransferItem(source[0].id));
  }

  async handleDrop(target: FavoriteItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(MIME_MOVE);
    if (!item) { return; }
    const draggedId: string = item.value;
    const targetId = target?.id ?? null;
    const parentGroupId = target?.type === "group" ? target.id : target?.groupId;
    await this.onReorder(draggedId, targetId, parentGroupId);
  }

  // ── Tree ─────────────────────────────────────────────────────────────────

  getTreeItem(element: FavoriteItem): vscode.TreeItem {
    // Virtual "Recent" items
    if ((element as any).__recentHeader) {
      const item = new vscode.TreeItem("Recent", vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("history");
      item.contextValue = "favLauncher.recentHeader";
      return item;
    }
    if ((element as any).__recentItem) {
      return this.getTreeItem((element as any).__recentItem);
    }

    // Onboarding placeholder
    if ((element as any).__onboarding) {
      const item = new vscode.TreeItem("Add your first favorite", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("star-add");
      item.tooltip = "Use the + buttons above to add files, folders or commands";
      item.command = { command: "favLauncher.addCurrentFile", title: "Add File or Folder" };
      return item;
    }

    if (element.type === "group") {
      const children = this.getItems().filter(x => x.groupId === element.id && x.type !== "separator");
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "favLauncher.group";
      item.iconPath = this.coloredIcon(element.icon ?? "folder", element.color);
      item.description = `(${children.length})`;
      return item;
    }

    if (element.type === "separator") {
      const label = element.separatorLabel ? `── ${element.separatorLabel} ──` : "─────────────────";
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "favLauncher.separator";
      return item;
    }

    if (element.type === "workspace" && element.workspacePath) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = element.pinned ? "favLauncher.item.pinned" : "favLauncher.item";
      item.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "window"), element.color);
      item.tooltip = this.buildRichTooltip({ label: element.label, detail: element.workspacePath, note: element.note, type: "workspace" });
      item.description = element.workspacePath;
      item.command = { command: "favLauncher.openWorkspace", title: "Open Workspace", arguments: [element] };
      return item;
    }

    const compact = vscode.workspace.getConfiguration("favLauncher").get<boolean>("compactMode", false);
    const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    treeItem.contextValue = element.pinned ? "favLauncher.item.pinned" : "favLauncher.item";

    if (element.type === "file" && element.path) {
      const uri = vscode.Uri.file(element.path);
      const missing = !this.pathExists(element.path);
      const isFolder = !missing && this.isDirectory(element.path);
      const gitBadge = !missing && !isFolder ? this.gitStatus.get(element.path) : undefined;
      const isDirty = !missing && !isFolder && this.dirtyFiles.has(element.path);
      const fileMeta = !missing && !isFolder ? this.getFileMeta(element.path) : undefined;

      treeItem.resourceUri = uri;
      treeItem.tooltip = this.buildRichTooltip({
        label: element.label,
        detail: missing ? `⚠️ Not found: ${element.path}` : element.path,
        note: element.note,
        type: "file",
        fileMeta,
        gitBadge: gitBadge ? this.gitBadgeLabel(gitBadge) : undefined,
        isDirty,
        lastUsed: element.lastUsed,
        pinned: element.pinned,
      });

      if (missing) {
        treeItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
        treeItem.description = "⚠ missing";
      } else if (isFolder) {
        treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "folder"), element.color);
        treeItem.command = { command: "favLauncher.revealInExplorer", title: "Reveal in Explorer", arguments: [uri] };
        treeItem.contextValue = element.pinned ? "favLauncher.item.folder.pinned" : "favLauncher.item.folder";
        if (!compact) { treeItem.description = this.buildDescription(this.shortenPath(element.path), element.note); }
      } else {
        if (element.icon || element.color || element.pinned) {
          treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "file"), element.color);
        }
        treeItem.command = { command: "vscode.open", title: "Open", arguments: [uri] };
        const pathPart = this.shortenPath(element.path);
        const gitPart = gitBadge ? `[${gitBadge}]` : undefined;
        const dirtyPart = isDirty ? "●" : undefined;
        const base = [dirtyPart, pathPart, gitPart].filter(Boolean).join(" ");
        if (!compact) { treeItem.description = this.buildDescription(base, element.note); }
      }

    } else if (element.type === "command" && element.commandId) {
      treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "run"), element.color);
      treeItem.command = { command: element.commandId, title: "Run", arguments: element.args ?? [] };
      treeItem.tooltip = this.buildRichTooltip({
        label: element.label,
        detail: `Command: ${element.commandId}`,
        note: element.note,
        type: "command",
        args: element.args,
        lastUsed: element.lastUsed,
        pinned: element.pinned,
      });
      if (!compact) { treeItem.description = this.buildDescription(element.commandId, element.note); }

    } else if (element.type === "macro") {
      const stepCount = (element.macroSteps ?? element.macroCommands ?? []).length;
      const steps = element.macroSteps ?? [];
      treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "list-ordered"), element.color);
      treeItem.command = { command: "favLauncher.runMacro", title: "Run Macro", arguments: [element] };
      treeItem.tooltip = this.buildRichTooltip({
        label: element.label,
        detail: `Macro — ${stepCount} step${stepCount !== 1 ? "s" : ""}`,
        note: element.note,
        type: "macro",
        macroSteps: steps,
        lastUsed: element.lastUsed,
        pinned: element.pinned,
      });
      if (!compact) { treeItem.description = this.buildDescription(`${stepCount} steps`, element.note); }
    }

    return treeItem;
  }

  getChildren(element?: FavoriteItem): FavoriteItem[] {
    const all = this.getItems();
    const sort = vscode.workspace.getConfiguration("favLauncher").get<SortOrder>("sortOrder", "manual");
    const showRecent = vscode.workspace.getConfiguration("favLauncher").get<boolean>("showRecentSection", false);

    if ((element as any)?.__recentHeader) {
      // Return top-5 recently used items as proxy objects
      const recent = all
        .filter(x => x.type !== "group" && x.type !== "separator" && x.lastUsed)
        .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
        .slice(0, 5);
      return recent.map(x => ({ ...x, id: `__recent__${x.id}`, __recentItem: x } as any));
    }

    if (!element) {
      const realItems = all.filter(x => x.type !== "separator");
      if (realItems.length === 0) { return [{ __onboarding: true } as any]; }

      let root = all.filter(x => !x.groupId);
      root = this.applyFilter(root, all);
      const sorted = this.sortItems(root, sort);

      if (showRecent && !this.filterText) {
        const hasRecent = all.some(x => x.type !== "group" && x.type !== "separator" && x.lastUsed);
        if (hasRecent) {
          const recentHeader: FavoriteItem = { __recentHeader: true, id: "__recentHeader__", type: "group", label: "Recent", order: -1 } as any;
          return [recentHeader, ...sorted];
        }
      }

      return sorted;
    }

    if ((element as any).__recentHeader) {
      const recent = all
        .filter(x => x.type !== "group" && x.type !== "separator" && x.lastUsed)
        .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
        .slice(0, 5);
      return recent.map(x => ({ ...x, id: `__recent__${x.id}`, __recentItem: x } as any));
    }

    if (element.type === "group") {
      let children = all.filter(x => x.groupId === element.id);
      children = this.applyFilter(children, all);
      return this.sortItems(children, sort);
    }

    return [];
  }

  getParent(element: FavoriteItem): FavoriteItem | undefined {
    if ((element as any).__recentItem) { return undefined; }
    if (!element.groupId) { return undefined; }
    return this.getItems().find(x => x.id === element.groupId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private applyFilter(items: FavoriteItem[], all: FavoriteItem[]): FavoriteItem[] {
    if (!this.filterText) { return items; }
    return items.filter(x => {
      if (x.label.toLowerCase().includes(this.filterText)) { return true; }
      if (x.note?.toLowerCase().includes(this.filterText)) { return true; }
      if (x.path?.toLowerCase().includes(this.filterText)) { return true; }
      if (x.commandId?.toLowerCase().includes(this.filterText)) { return true; }
      // Include groups whose name matches (show whole group)
      if (x.type === "group") { return true; }
      // Include items whose parent group name matches
      if (x.groupId) {
        const parent = all.find(g => g.id === x.groupId);
        if (parent?.label.toLowerCase().includes(this.filterText)) { return true; }
      }
      return false;
    });
  }

  private sortItems(items: FavoriteItem[], sort: SortOrder): FavoriteItem[] {
    return items.slice().sort((a, b) => {
      if (a.pinned && !b.pinned) { return -1; }
      if (!a.pinned && b.pinned) { return 1; }
      if (sort === "alpha") { return a.label.localeCompare(b.label); }
      if (sort === "type") {
        if (a.type !== b.type) { return a.type.localeCompare(b.type); }
        return a.label.localeCompare(b.label);
      }
      if (sort === "lastUsed") { return (b.lastUsed ?? 0) - (a.lastUsed ?? 0); }
      return a.order - b.order;
    });
  }

  private getNoteDisplay(): "tooltip" | "inline" | "both" {
    return vscode.workspace.getConfiguration("favLauncher").get<"tooltip" | "inline" | "both">("noteDisplay", "both");
  }

  private buildDescription(base: string, note?: string): string | undefined {
    const noteDisplay = this.getNoteDisplay();
    const itemDesc = vscode.workspace.getConfiguration("favLauncher").get<string>("itemDescription", "both");
    const showPath = itemDesc === "path" || itemDesc === "both";
    const showNote = (itemDesc === "note" || itemDesc === "both") && noteDisplay !== "tooltip";
    const parts: string[] = [];
    if (showPath && base) { parts.push(base); }
    if (showNote && note) { parts.push(note); }
    return parts.length > 0 ? parts.join("  •  ") : undefined;
  }

  /** Rich markdown hover card */
  private buildRichTooltip(opts: {
    label: string;
    detail: string;
    note?: string;
    type: string;
    fileMeta?: string;
    gitBadge?: string;
    isDirty?: boolean;
    lastUsed?: number;
    pinned?: boolean;
    macroSteps?: Array<{ kind: string; commandId?: string; text?: string }>;
    args?: any[];
  }): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;

    // Header
    const typeIcon: Record<string, string> = {
      file: "file", command: "run", macro: "list-ordered", workspace: "window",
    };
    const icon = typeIcon[opts.type] ?? "star";
    md.appendMarkdown(`**$(${icon}) ${escMd(opts.label)}**\n\n`);

    // Detail line
    md.appendMarkdown(`\`${escMd(opts.detail)}\`\n\n`);

    // File metadata
    if (opts.fileMeta) {
      md.appendMarkdown(`$(info) ${escMd(opts.fileMeta)}\n\n`);
    }

    // Git badge
    if (opts.gitBadge) {
      md.appendMarkdown(`$(source-control) Git: **${escMd(opts.gitBadge)}**\n\n`);
    }

    // Unsaved indicator
    if (opts.isDirty) {
      md.appendMarkdown(`$(circle-filled) **Unsaved changes**\n\n`);
    }

    // Macro steps
    if (opts.macroSteps && opts.macroSteps.length > 0) {
      md.appendMarkdown(`**Steps:**\n`);
      for (const step of opts.macroSteps) {
        if (step.kind === "terminal") {
          md.appendMarkdown(`- \`$ ${escMd(step.text ?? "")}\`\n`);
        } else {
          md.appendMarkdown(`- $(run) \`${escMd(step.commandId ?? "")}\`\n`);
        }
      }
      md.appendMarkdown("\n");
    }

    // Args
    if (opts.args && opts.args.length > 0) {
      md.appendMarkdown(`**Args:** \`${escMd(JSON.stringify(opts.args))}\`\n\n`);
    }

    // Note
    if (opts.note) {
      const noteDisplay = this.getNoteDisplay();
      if (noteDisplay !== "inline") {
        md.appendMarkdown(`---\n📝 *${escMd(opts.note)}*\n\n`);
      }
    }

    // Meta footer
    const footer: string[] = [];
    if (opts.pinned) { footer.push("$(pinned) Pinned"); }
    if (opts.lastUsed) {
      const d = new Date(opts.lastUsed);
      footer.push(`$(history) Last used: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`);
    }
    if (footer.length > 0) {
      md.appendMarkdown(`---\n${footer.join("  •  ")}`);
    }

    return md;
  }

  private coloredIcon(baseIcon: string, color?: string): vscode.ThemeIcon {
    if (!color) { return new vscode.ThemeIcon(baseIcon); }
    const colorMap: Record<string, string> = {
      red:    "terminal.ansiRed",
      orange: "terminal.ansiYellow",
      yellow: "terminal.ansiBrightYellow",
      green:  "terminal.ansiGreen",
      blue:   "terminal.ansiBlue",
      purple: "terminal.ansiMagenta",
    };
    const themeColor = colorMap[color];
    return themeColor
      ? new vscode.ThemeIcon(baseIcon, new vscode.ThemeColor(themeColor))
      : new vscode.ThemeIcon(baseIcon);
  }

  private getFileMeta(fsPath: string): string | undefined {
    try {
      const stat = fs.statSync(fsPath);
      const size = this.formatBytes(stat.size);
      const modified = stat.mtime.toLocaleString();
      return `Size: ${size}  |  Modified: ${modified}`;
    } catch { return undefined; }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private gitBadgeLabel(badge: string): string {
    const map: Record<string, string> = {
      M: "Modified", A: "Added", D: "Deleted", R: "Renamed",
      C: "Copied", U: "Unmerged", "?": "Untracked",
    };
    return map[badge] ?? badge;
  }

  private pathExists(fsPath: string): boolean {
    try { fs.accessSync(fsPath); return true; } catch { return false; }
  }

  private isDirectory(fsPath: string): boolean {
    try { return fs.statSync(fsPath).isDirectory(); } catch { return false; }
  }

  private shortenPath(fullPath: string): string {
    const parts = fullPath.replace(/\\/g, "/").split("/");
    if (parts.length <= 2) { return ""; }
    return "…/" + parts.slice(-2, -1).join("/");
  }
}

function escMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}
