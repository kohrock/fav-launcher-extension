export type FavoriteType = "file" | "command" | "macro" | "separator" | "group" | "workspace";

export type MacroStep =
  | { kind: "command"; commandId: string }
  | { kind: "terminal"; text: string };

export type FavoriteItem = {
  id: string;
  type: FavoriteType;
  label: string;
  pinned?: boolean;
  groupId?: string;
  order: number;
  icon?: string;       // custom codicon name e.g. "rocket"
  color?: string;      // color label: "red" | "orange" | "yellow" | "green" | "blue" | "purple"
  lastUsed?: number;   // timestamp ms

  // file
  path?: string;

  // command
  commandId?: string;
  args?: any[];

  // macro
  macroCommands?: string[];    // legacy
  macroSteps?: MacroStep[];

  // separator title
  separatorLabel?: string;

  // workspace switcher
  workspacePath?: string;   // path to .code-workspace file or folder

  // optional note
  note?: string;
};

export const STORAGE_KEY = "favLauncher.items.v2";
export const TEAM_STORAGE_FILE = ".vscode/favorites.json";
export const MIME_MOVE = "application/vnd.favlauncher.item";

export type SortOrder = "manual" | "alpha" | "type" | "lastUsed";
