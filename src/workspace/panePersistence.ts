import { createSinglePaneLayout, flattenPaneIds, type LayoutNode, type PaneId } from "./paneLayout";

export interface PaneSnapshot {
  id: PaneId;
  openTabs: string[];
  activePath: string | null;
}

export interface PaneWorkspaceSnapshot {
  version: 1;
  root: LayoutNode;
  activePaneId: PaneId;
  panes: PaneSnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function evenRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeRatios(value: unknown, count: number): number[] {
  if (!Array.isArray(value)) return evenRatios(count);
  if (value.length !== count) return evenRatios(count);
  const ratios = value.filter((ratio): ratio is number => typeof ratio === "number" && Number.isFinite(ratio));
  return ratios.length === count ? ratios : evenRatios(count);
}

function normalizeLayoutNode(value: unknown, seen = new Set<object>()): LayoutNode | null {
  if (!isRecord(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (value.type === "pane") {
    seen.delete(value);
    return typeof value.paneId === "string" ? { type: "pane", paneId: value.paneId } : null;
  }

  if (value.type !== "split" || (value.direction !== "row" && value.direction !== "column")) {
    seen.delete(value);
    return null;
  }

  if (!Array.isArray(value.children)) {
    seen.delete(value);
    return null;
  }

  const children: LayoutNode[] = [];
  for (const child of value.children) {
    const normalized = normalizeLayoutNode(child, seen);
    if (!normalized) {
      seen.delete(value);
      return null;
    }
    children.push(normalized);
  }
  seen.delete(value);

  if (children.length === 0) return null;
  return {
    type: "split",
    direction: value.direction,
    children,
    ratios: normalizeRatios(value.ratios, children.length),
  };
}

function singlePaneFromLegacy(legacyOpenTabs: string[]): PaneWorkspaceSnapshot {
  const openTabs = legacyOpenTabs.filter((path): path is string => typeof path === "string");
  return {
    version: 1,
    root: createSinglePaneLayout("pane-1"),
    activePaneId: "pane-1",
    panes: [{ id: "pane-1", openTabs, activePath: openTabs[0] ?? null }],
  };
}

function normalizePaneSnapshot(value: unknown, paneIds: Set<PaneId>): PaneSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || !paneIds.has(value.id)) return null;
  const openTabs = Array.isArray(value.openTabs)
    ? value.openTabs.filter((path): path is string => typeof path === "string")
    : [];
  const activePath =
    typeof value.activePath === "string" && openTabs.includes(value.activePath)
      ? value.activePath
      : (openTabs[0] ?? null);
  return { id: value.id, openTabs, activePath };
}

export function normalizePaneWorkspaceSnapshot(
  value: unknown,
  legacyOpenTabs: string[],
): PaneWorkspaceSnapshot {
  if (!isRecord(value) || value.version !== 1) return singlePaneFromLegacy(legacyOpenTabs);

  const root = normalizeLayoutNode(value.root);
  if (!root) return singlePaneFromLegacy(legacyOpenTabs);

  const paneIds = flattenPaneIds(root);
  if (paneIds.length === 0) return singlePaneFromLegacy(legacyOpenTabs);

  const paneIdSet = new Set(paneIds);
  const seenPaneIds = new Set<PaneId>();
  const panes = (Array.isArray(value.panes) ? value.panes : [])
    .map((pane) => normalizePaneSnapshot(pane, paneIdSet))
    .filter((pane): pane is PaneSnapshot => {
      if (!pane || seenPaneIds.has(pane.id)) return false;
      seenPaneIds.add(pane.id);
      return true;
    });

  if (panes.length === 0) return singlePaneFromLegacy(legacyOpenTabs);

  const normalizedPaneIds = new Set(panes.map((pane) => pane.id));
  const activePaneId =
    typeof value.activePaneId === "string" && normalizedPaneIds.has(value.activePaneId)
      ? value.activePaneId
      : panes[0].id;

  return { version: 1, root, activePaneId, panes };
}

export function serializePaneWorkspaceSnapshot(snapshot: PaneWorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}
