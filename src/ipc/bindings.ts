import { invoke } from "@tauri-apps/api/core";

export type Result<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

export interface FileNode { name: string; path: string; isDir: boolean; children: FileNode[]; }
export interface LayoutSettings { sidebarWidth: number | null; outlineHeight: number | null; splitRatio: number | null; }
export type PaneLayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; direction: "row" | "column"; children: PaneLayoutNode[]; ratios: number[] };
export interface PaneSnapshot { id: string; openTabs: string[]; activePath: string | null; }
export interface PaneWorkspaceSnapshot { version: 1; root: PaneLayoutNode; activePaneId: string; panes: PaneSnapshot[]; }
export interface Settings { theme: string | null; lastFolder: string | null; openTabs: string[]; locale: string | null; editorWidth: string | null; editorMode: string | null; sidebarWidth: number | null; layout: LayoutSettings | null; workbenchLayout: unknown | null; namedLayouts: unknown | null; activeNamedLayout: string | null; focusMode: boolean | null; typewriterMode: boolean | null; paneLayout: PaneWorkspaceSnapshot | null; uiScale: number | null; editorFontScale: number | null; }
export interface SearchHit { path: string; line: number; snippet: string; }
export interface SearchResults { hits: SearchHit[]; truncated: boolean; }
export interface WorkspaceIndexStats { documents: number; bytes: number; }
export interface WorkspaceIndexHeading { path: string; name: string; text: string; level: number; line: number; }
export interface LinkTargetHeading { text: string; level: number; line: number; }
export interface LinkTarget { path: string; relativePath: string; href: string; name: string; title: string; headings: LinkTargetHeading[]; }
export interface Backlink { path: string; name: string; line: number; href: string; }
export type PropertyKey = "title" | "tags" | "aliases" | "lang";
export interface PropertyDocument { path: string; relativePath: string; name: string; title: string; properties: Partial<Record<PropertyKey, string[]>>; }
export interface PathChange { from: string; to: string; }
export interface LinkReplacement { line: number; oldHref: string; newHref: string; byteStart: number; byteEnd: number; }
export interface PlannedDocumentEdit { path: string; resultingPath: string; replacements: LinkReplacement[]; }
export type PathChangeIssueKind = "destinationExists" | "staleIndex" | "unreadableDocument" | "unresolvedLink" | "unsupportedLink";
export interface PathChangeIssue { kind: PathChangeIssueKind; path: string; href: string | null; blocking: boolean; }
export interface PathChangePlan { planId: string; source: string; destination: string; canApply: boolean; pathChanges: PathChange[]; edits: PlannedDocumentEdit[]; issues: PathChangeIssue[]; }
export interface PublishAsset { sourcePath: string; relativePath: string; }

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { status: "ok", data: (await invoke(cmd, args)) as T };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export const commands = {
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  readFile: (path: string) => call<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    call<null>("write_file", { path, contents }),
  writeFileIfUnchanged: (path: string, expectedContents: string | null, contents: string) =>
    call<boolean>("write_file_if_unchanged", { path, expectedContents, contents }),
  publishProjectHtml: (workspaceRoot: string, path: string, contents: string, assets: PublishAsset[], protectedPaths: string[]) =>
    call<null>("publish_project_html", { workspaceRoot, path, contents, assets, protectedPaths }),
  saveAsset: (docPath: string, bytes: number[], ext: string) =>
    call<string>("save_asset", { docPath, bytes, ext }),
  listDir: (path: string) => call<FileNode[]>("list_dir", { path }),
  loadSettings: () => call<Settings>("load_settings", {}),
  saveSettings: (settings: Settings) => call<null>("save_settings", { settings }),
  watchFolder: (path: string) => call<null>("watch_folder", { path }),
  search: (root: string, query: string, requestId: number) =>
    call<SearchResults>("search", { root, query, requestId }),
  cancelSearch: (requestId: number) => call<null>("cancel_search", { requestId }),
  rebuildWorkspaceIndex: (root: string) => call<WorkspaceIndexStats>("rebuild_workspace_index", { root }),
  updateWorkspaceIndex: (root: string, paths: string[]) => call<WorkspaceIndexStats>("update_workspace_index", { root, paths }),
  searchWorkspaceIndex: (root: string, scopeRoot: string | null, query: string, activePath: string | null, requestId: number) =>
    call<SearchResults>("search_workspace_index", { root, scopeRoot, query, activePath, requestId }),
  workspaceIndexHeadings: (root: string) => call<WorkspaceIndexHeading[]>("workspace_index_headings", { root }),
  workspaceIndexLinkTargets: (root: string, sourcePath: string | null) =>
    call<LinkTarget[]>("workspace_index_link_targets", { root, sourcePath }),
  workspaceIndexBacklinks: (root: string, targetPath: string) =>
    call<Backlink[]>("workspace_index_backlinks", { root, targetPath }),
  workspaceIndexPropertyDocuments: (root: string) =>
    call<PropertyDocument[]>("workspace_index_property_documents", { root }),
  planPathChange: (root: string, source: string, destination: string) =>
    call<PathChangePlan>("plan_path_change", { root, source, destination }),
  applyPathChange: (root: string, source: string, destination: string, expectedPlanId: string) =>
    call<WorkspaceIndexStats>("apply_path_change", { root, source, destination, expectedPlanId }),
  takeLaunchFile: () => call<string | null>("take_launch_file", {}),
  openDefaultAppsSettings: () => call<null>("open_default_apps_settings", {}),
  deletePath: (path: string) => call<null>("delete_path", { path }),
  createFile: (dir: string, name: string) =>
    call<string>("create_file", { dir, name }),
  createDir: (dir: string, name: string) =>
    call<string>("create_dir", { dir, name }),
};
