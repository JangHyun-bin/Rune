export interface HotExitTabSnapshot {
  path: string | null;
  savedText: string;
  currentText: string;
  active: boolean;
}

export interface HotExitPaneSnapshot {
  id: string;
  tabs: HotExitTabSnapshot[];
}

export interface HotExitSnapshot {
  version: 1;
  workspaceRoot: string | null;
  activePaneId: string;
  panes: HotExitPaneSnapshot[];
}

export type ResolvedHotExitTab =
  | (HotExitTabSnapshot & { kind: "file"; path: string })
  | { kind: "alreadySaved"; path: string; currentText: string; active: boolean }
  | { kind: "untitled"; currentText: string; recoveredFrom: string | null; active: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTab(value: unknown): HotExitTabSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.path !== null && typeof value.path !== "string") return null;
  if (typeof value.savedText !== "string" || typeof value.currentText !== "string") return null;
  if (typeof value.active !== "boolean") return null;
  return {
    path: value.path,
    savedText: value.savedText,
    currentText: value.currentText,
    active: value.active,
  };
}

export function parseHotExitSnapshot(value: unknown): HotExitSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.workspaceRoot !== null && typeof value.workspaceRoot !== "string") return null;
  if (typeof value.activePaneId !== "string" || !Array.isArray(value.panes)) return null;

  const panes: HotExitPaneSnapshot[] = [];
  const paneIds = new Set<string>();
  for (const candidate of value.panes) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !Array.isArray(candidate.tabs)) return null;
    if (paneIds.has(candidate.id)) return null;
    paneIds.add(candidate.id);
    const tabs: HotExitTabSnapshot[] = [];
    for (const tab of candidate.tabs) {
      const parsed = parseTab(tab);
      if (!parsed) return null;
      tabs.push(parsed);
    }
    panes.push({ id: candidate.id, tabs });
  }

  return {
    version: 1,
    workspaceRoot: value.workspaceRoot,
    activePaneId: value.activePaneId,
    panes,
  };
}

export async function resolveHotExitTab(
  tab: HotExitTabSnapshot,
  readFile: (path: string) => Promise<string | null>,
): Promise<ResolvedHotExitTab> {
  if (tab.path === null) {
    return {
      kind: "untitled",
      currentText: tab.currentText,
      recoveredFrom: null,
      active: tab.active,
    };
  }

  const diskText = await readFile(tab.path);
  if (diskText === tab.savedText) {
    return { kind: "file", ...tab, path: tab.path };
  }
  if (diskText === tab.currentText) {
    return {
      kind: "alreadySaved",
      path: tab.path,
      currentText: tab.currentText,
      active: tab.active,
    };
  }
  return {
    kind: "untitled",
    currentText: tab.currentText,
    recoveredFrom: tab.path,
    active: tab.active,
  };
}
