import type { WorkbenchContainerId, WorkbenchLayoutSnapshot, WorkbenchViewId } from "./workbenchLayout";

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowMonitorSnapshot extends WindowBounds { name: string | null; scaleFactor: number }
export interface PersistedViewWindow {
  containerId: WorkbenchContainerId;
  groupId: string;
  activeViewId: WorkbenchViewId;
  bounds: WindowBounds;
  monitor: WindowMonitorSnapshot;
}
export interface ViewWindowLayoutSnapshot {
  version: 1;
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

export const EMPTY_VIEW_WINDOW_LAYOUT: ViewWindowLayoutSnapshot = { version: 1, sessionState: "clean", windows: [] };
const containers = new Set<WorkbenchContainerId>(["explorer", "search", "auxiliary", "panel"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
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

export function normalizeViewWindowLayout(value: unknown, workbench: WorkbenchLayoutSnapshot): ViewWindowLayoutSnapshot {
  const root = record(value);
  if (!root || !only(root, ["version", "sessionState", "windows"]) || root.version !== 1
    || (root.sessionState !== "clean" && root.sessionState !== "running") || !Array.isArray(root.windows)) {
    return { ...EMPTY_VIEW_WINDOW_LAYOUT, windows: [] };
  }
  const windows: PersistedViewWindow[] = [];
  const seen = new Set<string>();
  for (const candidate of root.windows.slice(0, 8)) {
    const item = record(candidate);
    if (!item || !only(item, ["containerId", "groupId", "activeViewId", "bounds", "monitor"])
      || !containers.has(item.containerId as WorkbenchContainerId) || typeof item.groupId !== "string"
      || typeof item.activeViewId !== "string") continue;
    const containerId = item.containerId as WorkbenchContainerId;
    const group = workbench.viewGroups[containerId].groups[item.groupId];
    const key = `${containerId}\0${item.groupId}`;
    const savedBounds = bounds(item.bounds);
    const savedMonitor = monitor(item.monitor);
    if (!group || !group.viewIds.includes(item.activeViewId as WorkbenchViewId) || seen.has(key) || !savedBounds || !savedMonitor) continue;
    seen.add(key);
    windows.push({ containerId, groupId: item.groupId, activeViewId: item.activeViewId as WorkbenchViewId, bounds: savedBounds, monitor: savedMonitor });
  }
  return { version: 1, sessionState: root.sessionState, windows };
}

export function recoverWindowBounds(saved: PersistedViewWindow, monitors: AvailableMonitor[], primaryName: string | null): WindowBounds {
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
