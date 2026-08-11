import type { ViewGroupLayoutNode } from "./viewGroupLayout";
import type { WorkbenchContainerId, WorkbenchLayoutSnapshot, WorkbenchViewId } from "./workbenchLayout";

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowMonitorSnapshot extends WindowBounds { name: string | null; scaleFactor: number }
export interface PersistedViewGroupReference {
  containerId: WorkbenchContainerId;
  groupId: string;
}
export interface PersistedViewWindow {
  label: string;
  groups: PersistedViewGroupReference[];
  root: ViewGroupLayoutNode;
  activeGroupId: string;
  activeViewId: WorkbenchViewId;
  bounds: WindowBounds;
  monitor: WindowMonitorSnapshot;
}
export interface ViewWindowLayoutSnapshot {
  version: 2;
  sessionState: "clean" | "running";
  windows: PersistedViewWindow[];
}
export interface AvailableMonitor {
  name: string | null;
  scaleFactor: number;
  workArea: WindowBounds;
}

export function normalizeCapturedWindowBounds(
  position: { x: number; y: number },
  size: { width: number; height: number },
  fallback: { width: number; height: number },
): WindowBounds {
  return {
    x: Number.isFinite(position.x) ? position.x : 0,
    y: Number.isFinite(position.y) ? position.y : 0,
    width: Number.isFinite(size.width) && size.width >= 200 ? size.width : fallback.width,
    height: Number.isFinite(size.height) && size.height >= 120 ? size.height : fallback.height,
  };
}

export const EMPTY_VIEW_WINDOW_LAYOUT: ViewWindowLayoutSnapshot = { version: 2, sessionState: "clean", windows: [] };
const containers = new Set<WorkbenchContainerId>(["explorer", "search", "auxiliary", "panel"]);
const windowLabelPattern = /^view-[1-9]\d*$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function bounds(value: unknown): WindowBounds | null {
  const item = record(value);
  if (!item || !only(item, ["x", "y", "width", "height"]) || !finite(item.x) || !finite(item.y)
    || !finite(item.width) || !finite(item.height) || item.width < 200 || item.height < 120
    || item.width > 20000 || item.height > 20000) return null;
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}
function monitor(value: unknown): WindowMonitorSnapshot | null {
  const item = record(value);
  if (!item || !only(item, ["name", "scaleFactor", "x", "y", "width", "height"])
    || (item.name !== null && typeof item.name !== "string") || !finite(item.scaleFactor)
    || item.scaleFactor < 0.5 || item.scaleFactor > 4) return null;
  const area = bounds({ x: item.x, y: item.y, width: item.width, height: item.height });
  return area ? { name: item.name as string | null, scaleFactor: item.scaleFactor, ...area } : null;
}

function groupKey(containerId: WorkbenchContainerId, groupId: string): string {
  return `${containerId}\0${groupId}`;
}

function duplicateViewGroups(workbench: WorkbenchLayoutSnapshot): Set<string> {
  const owners = new Map<WorkbenchViewId, string>();
  const duplicates = new Set<string>();
  for (const [containerId, layout] of Object.entries(workbench.viewGroups) as Array<[WorkbenchContainerId, typeof workbench.viewGroups[WorkbenchContainerId]]>) {
    for (const group of Object.values(layout.groups)) {
      for (const viewId of group.viewIds) {
        const key = groupKey(containerId, group.id);
        const previous = owners.get(viewId);
        if (previous) {
          duplicates.add(previous);
          duplicates.add(key);
        } else owners.set(viewId, key);
      }
    }
  }
  return duplicates;
}

function parseGroupReferences(
  value: unknown,
  workbench: WorkbenchLayoutSnapshot,
  invalidGroups: Set<string>,
): PersistedViewGroupReference[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null;
  const result: PersistedViewGroupReference[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !only(item, ["containerId", "groupId"])
      || !containers.has(item.containerId as WorkbenchContainerId)
      || typeof item.groupId !== "string" || !item.groupId) return null;
    const containerId = item.containerId as WorkbenchContainerId;
    const key = groupKey(containerId, item.groupId);
    if (seen.has(key) || invalidGroups.has(key) || !workbench.viewGroups[containerId].groups[item.groupId]) return null;
    seen.add(key);
    result.push({ containerId, groupId: item.groupId });
  }
  return result;
}

function parseGroupTree(
  value: unknown,
  groupIds: Set<string>,
  seenObjects: Set<object>,
  visitedGroups: string[],
): ViewGroupLayoutNode | null {
  const item = record(value);
  if (!item || seenObjects.has(item)) return null;
  seenObjects.add(item);
  if (item.type === "group") {
    if (!only(item, ["type", "groupId"]) || typeof item.groupId !== "string"
      || !groupIds.has(item.groupId) || visitedGroups.includes(item.groupId)) return null;
    visitedGroups.push(item.groupId);
    return { type: "group", groupId: item.groupId };
  }
  if (item.type !== "split" || !only(item, ["type", "direction", "children", "ratios"])
    || (item.direction !== "row" && item.direction !== "column") || !Array.isArray(item.children)
    || item.children.length < 2 || !Array.isArray(item.ratios) || item.ratios.length !== item.children.length
    || !item.ratios.every((ratio) => finite(ratio) && ratio > 0)) return null;
  const children: ViewGroupLayoutNode[] = [];
  for (const child of item.children) {
    const parsed = parseGroupTree(child, groupIds, seenObjects, visitedGroups);
    if (!parsed) return null;
    children.push(parsed);
  }
  return { type: "split", direction: item.direction, children, ratios: [...item.ratios] as number[] };
}

function normalizeVersion2Window(
  value: unknown,
  workbench: WorkbenchLayoutSnapshot,
  invalidGroups: Set<string>,
): PersistedViewWindow | null {
  const item = record(value);
  if (!item || !only(item, ["label", "groups", "root", "activeGroupId", "activeViewId", "bounds", "monitor"])
    || typeof item.label !== "string" || !windowLabelPattern.test(item.label)
    || typeof item.activeGroupId !== "string" || typeof item.activeViewId !== "string") return null;
  const groups = parseGroupReferences(item.groups, workbench, invalidGroups);
  const savedBounds = bounds(item.bounds);
  const savedMonitor = monitor(item.monitor);
  if (!groups || !savedBounds || !savedMonitor) return null;
  const groupIds = new Set(groups.map((group) => group.groupId));
  if (groupIds.size !== groups.length || !groupIds.has(item.activeGroupId)) return null;
  const visitedGroups: string[] = [];
  const root = parseGroupTree(item.root, groupIds, new Set(), visitedGroups);
  if (!root || visitedGroups.some((id, index) => id !== groups[index].groupId) || visitedGroups.length !== groups.length) return null;
  const activeRef = groups.find((group) => group.groupId === item.activeGroupId)!;
  const activeGroup = workbench.viewGroups[activeRef.containerId].groups[activeRef.groupId];
  if (!activeGroup.viewIds.includes(item.activeViewId as WorkbenchViewId)) return null;
  return {
    label: item.label,
    groups,
    root,
    activeGroupId: item.activeGroupId,
    activeViewId: item.activeViewId as WorkbenchViewId,
    bounds: savedBounds,
    monitor: savedMonitor,
  };
}

function normalizeVersion1Window(
  value: unknown,
  index: number,
  workbench: WorkbenchLayoutSnapshot,
  invalidGroups: Set<string>,
): PersistedViewWindow | null {
  const item = record(value);
  if (!item || !only(item, ["containerId", "groupId", "activeViewId", "bounds", "monitor"])
    || !containers.has(item.containerId as WorkbenchContainerId) || typeof item.groupId !== "string"
    || typeof item.activeViewId !== "string") return null;
  const containerId = item.containerId as WorkbenchContainerId;
  const group = workbench.viewGroups[containerId].groups[item.groupId];
  const savedBounds = bounds(item.bounds);
  const savedMonitor = monitor(item.monitor);
  if (!group || invalidGroups.has(groupKey(containerId, item.groupId))
    || !group.viewIds.includes(item.activeViewId as WorkbenchViewId) || !savedBounds || !savedMonitor) return null;
  return {
    label: `view-${index + 1}`,
    groups: [{ containerId, groupId: item.groupId }],
    root: { type: "group", groupId: item.groupId },
    activeGroupId: item.groupId,
    activeViewId: item.activeViewId as WorkbenchViewId,
    bounds: savedBounds,
    monitor: savedMonitor,
  };
}

export function normalizeViewWindowLayout(value: unknown, workbench: WorkbenchLayoutSnapshot): ViewWindowLayoutSnapshot {
  const root = record(value);
  const empty = (): ViewWindowLayoutSnapshot => ({ ...EMPTY_VIEW_WINDOW_LAYOUT, windows: [] });
  if (!root || (root.version !== 1 && root.version !== 2)
    || (root.sessionState !== "clean" && root.sessionState !== "running") || !Array.isArray(root.windows)) return empty();
  const validRootKeys = root.version === 2
    ? ["version", "sessionState", "windows", ...(Object.prototype.hasOwnProperty.call(root, "transaction") ? ["transaction"] : [])]
    : ["version", "sessionState", "windows"];
  if (!only(root, validRootKeys)) return empty();
  const invalidGroups = duplicateViewGroups(workbench);
  const windows: PersistedViewWindow[] = [];
  const ownedGroups = new Set<string>();
  const labels = new Set<string>();
  for (const [index, candidate] of root.windows.slice(0, 8).entries()) {
    const normalized = root.version === 2
      ? normalizeVersion2Window(candidate, workbench, invalidGroups)
      : normalizeVersion1Window(candidate, index, workbench, invalidGroups);
    if (!normalized || labels.has(normalized.label)) continue;
    const keys = normalized.groups.map((group) => groupKey(group.containerId, group.groupId));
    if (keys.some((key) => ownedGroups.has(key))) continue;
    labels.add(normalized.label);
    keys.forEach((key) => ownedGroups.add(key));
    windows.push(normalized);
  }
  return { version: 2, sessionState: root.sessionState, windows };
}

export function recoverWindowBounds(saved: Pick<PersistedViewWindow, "bounds" | "monitor">, monitors: AvailableMonitor[], primaryName: string | null): WindowBounds {
  const target = monitors.find((item) => item.name !== null && item.name === saved.monitor.name)
    ?? monitors.find((item) => item.name === primaryName)
    ?? monitors[0];
  if (!target) return { x: 0, y: 0, width: 420, height: 640 };
  const ratio = target.scaleFactor / saved.monitor.scaleFactor;
  const area = target.workArea;
  const width = Math.min(area.width, Math.max(280, Math.round(saved.bounds.width * ratio)));
  const height = Math.min(area.height, Math.max(240, Math.round(saved.bounds.height * ratio)));
  const proposedX = Math.round(area.x + (saved.bounds.x - saved.monitor.x) * ratio);
  const proposedY = Math.round(area.y + (saved.bounds.y - saved.monitor.y) * ratio);
  return {
    x: Math.min(area.x + area.width - width, Math.max(area.x, proposedX)),
    y: Math.min(area.y + area.height - height, Math.max(area.y, proposedY)),
    width,
    height,
  };
}
