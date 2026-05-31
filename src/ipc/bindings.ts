import { invoke } from "@tauri-apps/api/core";

export type Result<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

export interface FileNode { name: string; path: string; isDir: boolean; children: FileNode[]; }
export interface Settings { theme: string | null; lastFolder: string | null; openTabs: string[]; }
export interface SearchHit { path: string; line: number; snippet: string; }

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { status: "ok", data: (await invoke(cmd, args)) as T };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export const commands = {
  readFile: (path: string) => call<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    call<null>("write_file", { path, contents }),
  saveAsset: (docPath: string, bytes: number[], ext: string) =>
    call<string>("save_asset", { docPath, bytes, ext }),
  listDir: (path: string) => call<FileNode[]>("list_dir", { path }),
  loadSettings: () => call<Settings>("load_settings", {}),
  saveSettings: (settings: Settings) => call<null>("save_settings", { settings }),
  watchFolder: (path: string) => call<null>("watch_folder", { path }),
  search: (root: string, query: string) => call<SearchHit[]>("search", { root, query }),
};
