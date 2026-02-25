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

  /** Returns count of file favorites whose paths no longer exist */
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
    // Onboarding placeholder
    if ((element as any).__onboarding) {
      const item = new vscode.TreeItem("Add your first favorite", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("star-add");
      item.tooltip = "Use the + buttons above to add files, folders or commands";
      item.command = { command: "favLauncher.addCurrentFile", title: "Add File or Folder" };
      return item;
    }

    if (element.type === "group") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "favLauncher.group";
      item.iconPath = this.coloredIcon(element.icon ?? "folder", element.color);
      return item;
    }

    if (element.type === "separator") {
      const item = new vscode.TreeItem("─────────────────", vscode.TreeItemCollapsibleState.None);
      item.contextValue = "favLauncher.separator";
      return item;
    }

    const compact = vscode.workspace.getConfiguration("favLauncher").get<boolean>("compactMode", false);
    const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    treeItem.contextValue = element.pinned ? "favLauncher.item.pinned" : "favLauncher.item";
    if (compact) {
      // In compact mode suppress description to keep rows tight
      treeItem.description = undefined;
    }

    if (element.type === "file" && element.path) {
      const uri = vscode.Uri.file(element.path);
      const missing = !this.pathExists(element.path);
      const isFolder = !missing && this.isDirectory(element.path);

      treeItem.resourceUri = uri;
      treeItem.tooltip = this.buildTooltip(
        missing ? `⚠️ Not found: ${element.path}` : element.path,
        element.note
      );

      if (missing) {
        treeItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
        treeItem.description = "⚠ missing";
        treeItem.contextValue = element.pinned ? "favLauncher.item.pinned" : "favLauncher.item";
      } else if (isFolder) {
        const baseIcon = element.pinned ? "pinned" : "folder";
        treeItem.iconPath = this.coloredIcon(element.icon ?? baseIcon, element.color);
        treeItem.command = { command: "favLauncher.revealInExplorer", title: "Reveal in Explorer", arguments: [uri] };
        treeItem.contextValue = element.pinned ? "favLauncher.item.folder.pinned" : "favLauncher.item.folder";
        if (!compact) { treeItem.description = this.buildDescription(this.shortenPath(element.path), element.note); }
      } else {
        if (element.icon || element.color || element.pinned) {
          treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "file"), element.color);
        }
        treeItem.command = { command: "vscode.open", title: "Open", arguments: [uri] };
        if (!compact) { treeItem.description = this.buildDescription(this.shortenPath(element.path), element.note); }
      }

    } else if (element.type === "command" && element.commandId) {
      treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "run"), element.color);
      treeItem.command = { command: element.commandId, title: "Run", arguments: element.args ?? [] };
      treeItem.tooltip = this.buildTooltip(`Command: ${element.commandId}`, element.note);
      if (!compact) { treeItem.description = this.buildDescription(element.commandId, element.note); }

    } else if (element.type === "macro") {
      const stepCount = (element.macroSteps ?? element.macroCommands ?? []).length;
      const stepSummary = (element.macroSteps ?? []).map(s =>
        s.kind === "terminal" ? `$ ${s.text}` : `⚡ ${s.commandId}`
      ).join("\n") || (element.macroCommands ?? []).join("\n");
      treeItem.iconPath = this.coloredIcon(element.icon ?? (element.pinned ? "pinned" : "list-ordered"), element.color);
      treeItem.command = { command: "favLauncher.runMacro", title: "Run Macro", arguments: [element] };
      treeItem.tooltip = this.buildTooltip(`${stepCount} steps:\n${stepSummary}`, element.note);
      if (!compact) { treeItem.description = this.buildDescription(`${stepCount} steps`, element.note); }
    }

    return treeItem;
  }

  getChildren(element?: FavoriteItem): FavoriteItem[] {
    const all = this.getItems();
    const sort = vscode.workspace.getConfiguration("favLauncher").get<SortOrder>("sortOrder", "manual");

    if (!element) {
      // Onboarding: show placeholder when list is empty
      const realItems = all.filter(x => x.type !== "separator");
      if (realItems.length === 0) {
        return [{ __onboarding: true } as any];
      }

      let root = all.filter(x => !x.groupId);
      root = this.applyFilter(root);
      return this.sortItems(root, sort);
    }

    if (element.type === "group") {
      let children = all.filter(x => x.groupId === element.id);
      children = this.applyFilter(children);
      return this.sortItems(children, sort);
    }

    return [];
  }

  getParent(element: FavoriteItem): FavoriteItem | undefined {
    if (!element.groupId) { return undefined; }
    return this.getItems().find(x => x.id === element.groupId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private applyFilter(items: FavoriteItem[]): FavoriteItem[] {
    if (!this.filterText) { return items; }
    return items.filter(x =>
      x.label.toLowerCase().includes(this.filterText) ||
      x.note?.toLowerCase().includes(this.filterText) ||
      x.path?.toLowerCase().includes(this.filterText) ||
      x.commandId?.toLowerCase().includes(this.filterText)
    );
  }

  private sortItems(items: FavoriteItem[], sort: SortOrder): FavoriteItem[] {
    const sorted = items.slice().sort((a, b) => {
      // Pinned always first
      if (a.pinned && !b.pinned) { return -1; }
      if (!a.pinned && b.pinned) { return 1; }

      if (sort === "alpha") { return a.label.localeCompare(b.label); }
      if (sort === "type") {
        if (a.type !== b.type) { return a.type.localeCompare(b.type); }
        return a.label.localeCompare(b.label);
      }
      if (sort === "lastUsed") {
        return (b.lastUsed ?? 0) - (a.lastUsed ?? 0);
      }
      return a.order - b.order;
    });
    return sorted;
  }

  private getNoteDisplay(): "tooltip" | "inline" | "both" {
    return vscode.workspace.getConfiguration("favLauncher").get<"tooltip" | "inline" | "both">("noteDisplay", "both");
  }

  private buildTooltip(base: string, note?: string): string {
    const display = this.getNoteDisplay();
    if (!note) { return base; }
    return display === "inline" ? base : `${base}\n\n📝 ${note}`;
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

  private coloredIcon(baseIcon: string, color?: string): vscode.ThemeIcon {
    if (!color) { return new vscode.ThemeIcon(baseIcon); }
    // Use terminal ANSI color tokens — supported by virtually all themes
    const colorMap: Record<string, string> = {
      red:    "terminal.ansiRed",
      orange: "terminal.ansiYellow",   // most themes don't have orange
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
