export type WorkbenchPartId = "primarySidebar" | "secondarySidebar" | "panel";
export type WorkbenchContainerId = "explorer" | "search" | "auxiliary" | "panel";
export type WorkbenchViewId = "workspace" | "outline" | "search";

export interface WorkbenchPartState {
  visible: boolean;
  size: number;
  activeContainerId: WorkbenchContainerId;
}

export interface WorkbenchContainerState {
  part: WorkbenchPartId;
  order: number;
}

export interface WorkbenchViewState {
  containerId: WorkbenchContainerId;
  order: number;
  visible: boolean;
  collapsed: boolean;
  size: number | null;
}

export interface WorkbenchLayoutSnapshot {
  version: 1;
  parts: Record<WorkbenchPartId, WorkbenchPartState>;
  containers: Record<WorkbenchContainerId, WorkbenchContainerState>;
  views: Record<WorkbenchViewId, WorkbenchViewState>;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayoutSnapshot = {
  version: 1,
  parts: {
    primarySidebar: { visible: true, size: 240, activeContainerId: "explorer" },
    secondarySidebar: { visible: false, size: 280, activeContainerId: "auxiliary" },
    panel: { visible: false, size: 220, activeContainerId: "panel" },
  },
  containers: {
    explorer: { part: "primarySidebar", order: 0 },
    search: { part: "primarySidebar", order: 1 },
    auxiliary: { part: "secondarySidebar", order: 0 },
    panel: { part: "panel", order: 0 },
  },
  views: {
    workspace: { containerId: "explorer", order: 0, visible: true, collapsed: false, size: null },
    outline: { containerId: "explorer", order: 1, visible: true, collapsed: false, size: 220 },
    search: { containerId: "search", order: 0, visible: true, collapsed: false, size: null },
  },
};

type LegacyLayout = { sidebarWidth?: unknown; outlineHeight?: unknown };

const partIds: WorkbenchPartId[] = ["primarySidebar", "secondarySidebar", "panel"];
const containerIds: WorkbenchContainerId[] = ["explorer", "search", "auxiliary", "panel"];
const viewIds: WorkbenchViewId[] = ["workspace", "outline", "search"];

function cloneLayout(layout: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  return {
    ...layout,
    parts: {
      primarySidebar: { ...layout.parts.primarySidebar },
      secondarySidebar: { ...layout.parts.secondarySidebar },
      panel: { ...layout.parts.panel },
    },
    containers: {
      explorer: { ...layout.containers.explorer },
      search: { ...layout.containers.search },
      auxiliary: { ...layout.containers.auxiliary },
      panel: { ...layout.containers.panel },
    },
    views: {
      workspace: { ...layout.views.workspace },
      outline: { ...layout.views.outline },
      search: { ...layout.views.search },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isPartId(value: unknown): value is WorkbenchPartId {
  return typeof value === "string" && partIds.includes(value as WorkbenchPartId);
}

function isContainerId(value: unknown): value is WorkbenchContainerId {
  return typeof value === "string" && containerIds.includes(value as WorkbenchContainerId);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampPartSize(partId: WorkbenchPartId, size: number): number {
  return Math.max(96, Math.min(partId === "panel" ? 600 : 720, size));
}

function clampOutlineSize(size: number): number {
  return Math.max(64, Math.min(600, size));
}

function isLayout(value: unknown): value is WorkbenchLayoutSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.parts) || !isRecord(value.containers) || !isRecord(value.views)) {
    return false;
  }
  const parts = value.parts;
  const containers = value.containers;
  const views = value.views;
  if (!hasOnlyKeys(parts, partIds) || !hasOnlyKeys(containers, containerIds) || !hasOnlyKeys(views, viewIds)) {
    return false;
  }
  return partIds.every((id) => {
    const part = parts[id];
    if (!isRecord(part) || typeof part.visible !== "boolean" || !isFiniteNumber(part.size) || !isContainerId(part.activeContainerId)) return false;
    const activeContainer = containers[part.activeContainerId];
    return isRecord(activeContainer) && activeContainer.part === id;
  }) && containerIds.every((id) => {
    const container = containers[id];
    return isRecord(container) && isPartId(container.part) && isFiniteNumber(container.order);
  }) && viewIds.every((id) => {
    const view = views[id];
    return isRecord(view) && isContainerId(view.containerId) && isFiniteNumber(view.order) && typeof view.visible === "boolean" && typeof view.collapsed === "boolean" && (view.size === null || isFiniteNumber(view.size));
  });
}

export function normalizeWorkbenchLayout(value: unknown, legacy?: LegacyLayout): WorkbenchLayoutSnapshot {
  const layout = isLayout(value) ? cloneLayout(value) : cloneLayout(DEFAULT_WORKBENCH_LAYOUT);
  if (!isLayout(value) && legacy) {
    if (isFiniteNumber(legacy.sidebarWidth)) layout.parts.primarySidebar.size = clampPartSize("primarySidebar", legacy.sidebarWidth);
    if (isFiniteNumber(legacy.outlineHeight)) layout.views.outline.size = clampOutlineSize(legacy.outlineHeight);
  }
  for (const partId of partIds) layout.parts[partId].size = clampPartSize(partId, layout.parts[partId].size);
  if (layout.views.outline.size !== null) layout.views.outline.size = clampOutlineSize(layout.views.outline.size);
  return layout;
}

export function openView(layout: WorkbenchLayoutSnapshot, viewId: WorkbenchViewId): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  const view = next.views[viewId];
  const partId = next.containers[view.containerId].part;
  next.views[viewId].visible = true;
  next.parts[partId].visible = true;
  next.parts[partId].activeContainerId = view.containerId;
  return next;
}

export function closeView(layout: WorkbenchLayoutSnapshot, viewId: WorkbenchViewId): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  next.views[viewId].visible = false;
  return next;
}

export function toggleViewCollapsed(layout: WorkbenchLayoutSnapshot, viewId: WorkbenchViewId): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  next.views[viewId].collapsed = !next.views[viewId].collapsed;
  return next;
}

export function activateContainer(layout: WorkbenchLayoutSnapshot, containerId: WorkbenchContainerId): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  const partId = next.containers[containerId].part;
  next.parts[partId].visible = true;
  next.parts[partId].activeContainerId = containerId;
  return next;
}

export function setPartSize(layout: WorkbenchLayoutSnapshot, partId: WorkbenchPartId, size: number): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  if (Number.isFinite(size)) next.parts[partId].size = clampPartSize(partId, size);
  return next;
}

export function resetViewVisibility(layout: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  for (const viewId of viewIds) {
    next.views[viewId].visible = DEFAULT_WORKBENCH_LAYOUT.views[viewId].visible;
    next.views[viewId].collapsed = DEFAULT_WORKBENCH_LAYOUT.views[viewId].collapsed;
  }
  return next;
}
