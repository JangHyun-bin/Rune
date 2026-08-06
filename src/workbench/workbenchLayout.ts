export type WorkbenchPartId = "primarySidebar" | "secondarySidebar" | "panel";
export type WorkbenchContainerId = "explorer" | "search" | "auxiliary" | "panel";
export type WorkbenchViewId = "workspace" | "outline" | "tags" | "project" | "search" | "backlinks" | "properties" | "references";
export type SidebarPosition = "left" | "right";
export type PanelPosition = "bottom" | "left" | "right";

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
  positions: {
    primarySidebar: SidebarPosition;
    panel: PanelPosition;
  };
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
    tags: { containerId: "explorer", order: 2, visible: true, collapsed: true, size: null },
    project: { containerId: "explorer", order: 3, visible: true, collapsed: true, size: null },
    search: { containerId: "search", order: 0, visible: true, collapsed: false, size: null },
    backlinks: { containerId: "auxiliary", order: 0, visible: true, collapsed: false, size: null },
    properties: { containerId: "auxiliary", order: 1, visible: true, collapsed: false, size: null },
    references: { containerId: "auxiliary", order: 2, visible: true, collapsed: false, size: null },
  },
  positions: {
    primarySidebar: "left",
    panel: "bottom",
  },
};

type LegacyLayout = { sidebarWidth?: unknown; outlineHeight?: unknown };

const partIds: WorkbenchPartId[] = ["primarySidebar", "secondarySidebar", "panel"];
const containerIds: WorkbenchContainerId[] = ["explorer", "search", "auxiliary", "panel"];
const viewIds: WorkbenchViewId[] = ["workspace", "outline", "tags", "project", "search", "backlinks", "properties", "references"];

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
      tags: { ...layout.views.tags },
      project: { ...layout.views.project },
      search: { ...layout.views.search },
      backlinks: { ...layout.views.backlinks },
      properties: { ...layout.views.properties },
      references: { ...layout.views.references },
    },
    positions: { ...layout.positions },
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
  return Math.round(Math.max(96, Math.min(partId === "panel" ? 600 : 720, size)));
}

function clampOutlineSize(size: number): number {
  return Math.round(Math.max(64, Math.min(600, size)));
}

function migrateWorkbenchLayout(value: unknown): WorkbenchLayoutSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.parts) || !isRecord(value.containers) || !isRecord(value.views)) {
    return null;
  }
  const parts = value.parts;
  const containers = value.containers;
  const views = value.views;
  const positions = value.positions;
  if (!hasOnlyKeys(parts, partIds) || !hasOnlyKeys(containers, containerIds)
    || Object.keys(views).some((id) => !viewIds.includes(id as WorkbenchViewId))
    || !["workspace", "outline", "search"].every((id) => id in views)) {
    return null;
  }
  const valid = partIds.every((id) => {
    const part = parts[id];
    if (!isRecord(part) || typeof part.visible !== "boolean" || !isFiniteNumber(part.size) || !isContainerId(part.activeContainerId)) return false;
    const activeContainer = containers[part.activeContainerId];
    return isRecord(activeContainer) && activeContainer.part === id;
  }) && containerIds.every((id) => {
    const container = containers[id];
    return isRecord(container) && isPartId(container.part) && isFiniteNumber(container.order);
  }) && Object.values(views).every((view) => {
    return isRecord(view) && isContainerId(view.containerId) && isFiniteNumber(view.order) && typeof view.visible === "boolean" && typeof view.collapsed === "boolean" && (view.size === null || isFiniteNumber(view.size));
  }) && (positions === undefined || (isRecord(positions)
    && hasOnlyKeys(positions, ["primarySidebar", "panel"])
    && (positions.primarySidebar === "left" || positions.primarySidebar === "right")
    && (positions.panel === "bottom" || positions.panel === "left" || positions.panel === "right")));
  if (!valid) return null;
  const migrated = cloneLayout(DEFAULT_WORKBENCH_LAYOUT);
  for (const id of partIds) migrated.parts[id] = { ...(parts[id] as unknown as WorkbenchPartState) };
  for (const id of containerIds) migrated.containers[id] = { ...(containers[id] as unknown as WorkbenchContainerState) };
  for (const id of viewIds) {
    if (isRecord(views[id])) migrated.views[id] = { ...(views[id] as unknown as WorkbenchViewState) };
  }
  if (isRecord(positions)) migrated.positions = { ...positions } as WorkbenchLayoutSnapshot["positions"];
  return migrated;
}

export function isWorkbenchLayoutSnapshot(value: unknown): value is WorkbenchLayoutSnapshot {
  return isRecord(value) && isRecord(value.views) && hasOnlyKeys(value.views, viewIds)
    && migrateWorkbenchLayout(value) !== null;
}

export function isMigratableWorkbenchLayout(value: unknown): boolean {
  return migrateWorkbenchLayout(value) !== null;
}

export function normalizeWorkbenchLayout(value: unknown, legacy?: LegacyLayout): WorkbenchLayoutSnapshot {
  const migrated = migrateWorkbenchLayout(value);
  const layout = migrated ?? cloneLayout(DEFAULT_WORKBENCH_LAYOUT);
  if (!migrated && legacy) {
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
  const partId = next.containers[next.views[viewId].containerId].part;
  if (partId !== "primarySidebar" && !viewIds.some((id) => next.views[id].visible && next.containers[next.views[id].containerId].part === partId)) {
    next.parts[partId].visible = false;
  }
  return next;
}

export function moveView(
  layout: WorkbenchLayoutSnapshot,
  viewId: WorkbenchViewId,
  containerId: WorkbenchContainerId,
  order?: number,
): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  const sourceContainerId = next.views[viewId].containerId;
  const orderedViews = (targetContainerId: WorkbenchContainerId): WorkbenchViewId[] =>
    viewIds.filter((id) => id !== viewId && next.views[id].containerId === targetContainerId)
      .sort((a, b) => next.views[a].order - next.views[b].order || a.localeCompare(b));
  const sourceViews = orderedViews(sourceContainerId);
  const destinationViews = sourceContainerId === containerId ? sourceViews : orderedViews(containerId);
  const index = Number.isFinite(order) ? Math.max(0, Math.min(destinationViews.length, Math.trunc(order as number))) : destinationViews.length;
  destinationViews.splice(index, 0, viewId);
  next.views[viewId].containerId = containerId;
  next.views[viewId].visible = true;
  if (sourceContainerId !== containerId) sourceViews.forEach((id, index) => { next.views[id].order = index; });
  destinationViews.forEach((id, index) => { next.views[id].containerId = containerId; next.views[id].order = index; });
  const destinationPart = next.containers[containerId].part;
  next.parts[destinationPart].visible = true;
  next.parts[destinationPart].activeContainerId = containerId;
  const sourcePart = next.containers[sourceContainerId].part;
  if (sourcePart !== destinationPart && !viewIds.some((id) => next.views[id].visible && next.containers[next.views[id].containerId].part === sourcePart)) {
    next.parts[sourcePart].visible = false;
  }
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

export function setPrimarySidebarPosition(
  layout: WorkbenchLayoutSnapshot,
  position: SidebarPosition,
): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  if (position === "left" || position === "right") next.positions.primarySidebar = position;
  return next;
}

export function setPanelPosition(layout: WorkbenchLayoutSnapshot, position: PanelPosition): WorkbenchLayoutSnapshot {
  const next = cloneLayout(layout);
  if (position === "bottom" || position === "left" || position === "right") next.positions.panel = position;
  return next;
}

export function resetViewLocations(layout: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  const next = cloneLayout(DEFAULT_WORKBENCH_LAYOUT);
  for (const partId of partIds) next.parts[partId].size = layout.parts[partId].size;
  next.positions = { ...layout.positions };
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
