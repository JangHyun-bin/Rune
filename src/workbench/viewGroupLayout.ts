import type { WorkbenchContainerId, WorkbenchViewId, WorkbenchViewState } from "./workbenchLayout";

export type ViewGroupSplitDirection = "row" | "column";
export type ViewGroupLayoutNode =
  | { type: "group"; groupId: string }
  | { type: "split"; direction: ViewGroupSplitDirection; children: ViewGroupLayoutNode[]; ratios: number[] };

export interface ViewGroupState {
  id: string;
  viewIds: WorkbenchViewId[];
  activeViewId: WorkbenchViewId | null;
}

export interface ViewGroupLayoutSnapshot {
  version: 1;
  root: ViewGroupLayoutNode;
  groups: Record<string, ViewGroupState>;
}

export interface SplitViewGroupRequest {
  sourceGroupId: string;
  newGroupId: string;
  viewId: WorkbenchViewId;
  direction: ViewGroupSplitDirection;
  side: "before" | "after";
}

export type WorkbenchViewGroupLayouts = Record<WorkbenchContainerId, ViewGroupLayoutSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseGroupNode(
  value: unknown,
  groupIds: Set<string>,
  seen: Set<object>,
): ViewGroupLayoutNode | null {
  if (!isRecord(value) || seen.has(value)) return null;
  seen.add(value);
  if (value.type === "group") {
    if (!hasOnlyKeys(value, ["type", "groupId"]) || typeof value.groupId !== "string" || !value.groupId || groupIds.has(value.groupId)) return null;
    groupIds.add(value.groupId);
    return { type: "group", groupId: value.groupId };
  }
  if (value.type !== "split" || !hasOnlyKeys(value, ["type", "direction", "children", "ratios"])
    || (value.direction !== "row" && value.direction !== "column") || !Array.isArray(value.children)
    || value.children.length < 2 || !Array.isArray(value.ratios) || value.ratios.length !== value.children.length
    || !value.ratios.every((ratio) => typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0)) return null;
  const children = value.children.map((child) => parseGroupNode(child, groupIds, seen));
  if (children.some((child) => child === null)) return null;
  return {
    type: "split",
    direction: value.direction,
    children: children as ViewGroupLayoutNode[],
    ratios: [...value.ratios],
  };
}

function cloneNode(node: ViewGroupLayoutNode): ViewGroupLayoutNode {
  return node.type === "group"
    ? { ...node }
    : { ...node, ratios: [...node.ratios], children: node.children.map(cloneNode) };
}

export function cloneViewGroupLayout(layout: ViewGroupLayoutSnapshot): ViewGroupLayoutSnapshot {
  return {
    ...layout,
    root: cloneNode(layout.root),
    groups: Object.fromEntries(Object.entries(layout.groups).map(([id, group]) => [id, {
      ...group,
      viewIds: [...group.viewIds],
    }])),
  };
}

function splitGroupNode(
  node: ViewGroupLayoutNode,
  sourceGroupId: string,
  newGroupId: string,
  direction: ViewGroupSplitDirection,
  side: "before" | "after",
): ViewGroupLayoutNode {
  if (node.type === "group") {
    if (node.groupId !== sourceGroupId) return node;
    const next: ViewGroupLayoutNode = { type: "group", groupId: newGroupId };
    return {
      type: "split",
      direction,
      ratios: [0.5, 0.5],
      children: side === "before" ? [next, node] : [node, next],
    };
  }
  const children = node.children.map((child) => splitGroupNode(child, sourceGroupId, newGroupId, direction, side));
  return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
}

function removeGroupNode(node: ViewGroupLayoutNode, groupId: string): ViewGroupLayoutNode | null {
  if (node.type === "group") return node.groupId === groupId ? null : node;
  const children: ViewGroupLayoutNode[] = [];
  const ratios: number[] = [];
  node.children.forEach((child, index) => {
    const next = removeGroupNode(child, groupId);
    if (!next) return;
    children.push(next);
    ratios.push(node.ratios[index] ?? 1);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, ratios };
}

function removeView(group: ViewGroupState, viewId: WorkbenchViewId): void {
  const index = group.viewIds.indexOf(viewId);
  if (index < 0) return;
  group.viewIds.splice(index, 1);
  if (group.activeViewId === viewId) group.activeViewId = group.viewIds[Math.min(index, group.viewIds.length - 1)] ?? null;
}

function sourceGroupId(layout: ViewGroupLayoutSnapshot, viewId: WorkbenchViewId): string | null {
  return Object.values(layout.groups).find((group) => group.viewIds.includes(viewId))?.id ?? null;
}

export function groupIdsInViewGroupLayout(layout: ViewGroupLayoutSnapshot): string[] {
  const visit = (node: ViewGroupLayoutNode): string[] => node.type === "group"
    ? [node.groupId]
    : node.children.flatMap(visit);
  return visit(layout.root);
}

export function viewGroupIdForView(layout: ViewGroupLayoutSnapshot, viewId: WorkbenchViewId): string | null {
  return sourceGroupId(layout, viewId);
}

export function createViewGroupLayout(
  groupId: string,
  viewIds: WorkbenchViewId[],
  activeViewId: WorkbenchViewId | null = viewIds[0] ?? null,
): ViewGroupLayoutSnapshot {
  const uniqueViewIds = [...new Set(viewIds)];
  return {
    version: 1,
    root: { type: "group", groupId },
    groups: {
      [groupId]: {
        id: groupId,
        viewIds: uniqueViewIds,
        activeViewId: activeViewId && uniqueViewIds.includes(activeViewId) ? activeViewId : uniqueViewIds[0] ?? null,
      },
    },
  };
}

export function createDefaultViewGroupLayouts(layout: { views: Record<WorkbenchViewId, WorkbenchViewState> }): WorkbenchViewGroupLayouts {
  const containerIds: WorkbenchContainerId[] = ["explorer", "search", "auxiliary", "panel"];
  const viewsIn = (containerId: WorkbenchContainerId): WorkbenchViewId[] =>
    (Object.keys(layout.views) as WorkbenchViewId[])
      .filter((viewId) => layout.views[viewId].containerId === containerId)
      .sort((a, b) => layout.views[a].order - layout.views[b].order || a.localeCompare(b));
  const result = {} as WorkbenchViewGroupLayouts;
  for (const containerId of containerIds) {
    const viewIds = viewsIn(containerId);
    if (containerId === "panel" || viewIds.length < 2) {
      result[containerId] = createViewGroupLayout(
        containerId === "panel" ? "panel:main" : `${containerId}:${viewIds[0] ?? "empty"}`,
        viewIds,
      );
      continue;
    }
    const groupIds = viewIds.map((viewId) => `${containerId}:${viewId}`);
    result[containerId] = {
      version: 1,
      root: {
        type: "split",
        direction: "column",
        children: groupIds.map((groupId) => ({ type: "group", groupId })),
        ratios: groupIds.map(() => 1 / groupIds.length),
      },
      groups: Object.fromEntries(viewIds.map((viewId, index) => {
        const id = groupIds[index];
        return [id, { id, viewIds: [viewId], activeViewId: viewId }];
      })),
    };
  }
  return result;
}

export function normalizeViewGroupLayout(
  value: unknown,
  fallback: ViewGroupLayoutSnapshot,
  allowedViewIds: WorkbenchViewId[],
): ViewGroupLayoutSnapshot {
  const invalid = () => cloneViewGroupLayout(fallback);
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "root", "groups"]) || value.version !== 1 || !isRecord(value.groups)) return invalid();
  const groupIds = new Set<string>();
  const root = parseGroupNode(value.root, groupIds, new Set());
  if (!root || Object.keys(value.groups).length !== groupIds.size || Object.keys(value.groups).some((id) => !groupIds.has(id))) return invalid();
  const allowed = new Set<WorkbenchViewId>(allowedViewIds);
  const seenViews = new Set<WorkbenchViewId>();
  const groups: Record<string, ViewGroupState> = {};
  for (const groupId of groupIds) {
    const candidate = value.groups[groupId];
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["id", "viewIds", "activeViewId"])
      || candidate.id !== groupId || !Array.isArray(candidate.viewIds)) return invalid();
    const viewIds: WorkbenchViewId[] = [];
    for (const viewId of candidate.viewIds) {
      if (typeof viewId !== "string" || !allowed.has(viewId as WorkbenchViewId) || seenViews.has(viewId as WorkbenchViewId)) return invalid();
      seenViews.add(viewId as WorkbenchViewId);
      viewIds.push(viewId as WorkbenchViewId);
    }
    if (candidate.activeViewId !== null
      && (typeof candidate.activeViewId !== "string" || !viewIds.includes(candidate.activeViewId as WorkbenchViewId))) return invalid();
    groups[groupId] = { id: groupId, viewIds, activeViewId: candidate.activeViewId as WorkbenchViewId | null };
  }
  if (seenViews.size !== allowed.size) return invalid();
  return { version: 1, root, groups };
}

export function splitViewGroup(
  layout: ViewGroupLayoutSnapshot,
  request: SplitViewGroupRequest,
): ViewGroupLayoutSnapshot {
  const source = layout.groups[request.sourceGroupId];
  if (!source || layout.groups[request.newGroupId] || source.viewIds.length < 2 || !source.viewIds.includes(request.viewId)) return layout;
  const root = splitGroupNode(layout.root, request.sourceGroupId, request.newGroupId, request.direction, request.side);
  if (root === layout.root) return layout;
  const next = cloneViewGroupLayout(layout);
  removeView(next.groups[request.sourceGroupId], request.viewId);
  next.groups[request.newGroupId] = { id: request.newGroupId, viewIds: [request.viewId], activeViewId: request.viewId };
  next.root = root;
  return next;
}

export function moveViewToGroup(
  layout: ViewGroupLayoutSnapshot,
  viewId: WorkbenchViewId,
  targetGroupId: string,
  order = Number.POSITIVE_INFINITY,
): ViewGroupLayoutSnapshot {
  if (!layout.groups[targetGroupId]) return layout;
  const next = cloneViewGroupLayout(layout);
  const sourceId = sourceGroupId(next, viewId);
  if (sourceId) {
    removeView(next.groups[sourceId], viewId);
    if (sourceId !== targetGroupId && next.groups[sourceId].viewIds.length === 0) {
      delete next.groups[sourceId];
      next.root = removeGroupNode(next.root, sourceId) ?? { type: "group", groupId: targetGroupId };
    }
  }
  const target = next.groups[targetGroupId];
  const index = Number.isFinite(order) ? Math.max(0, Math.min(target.viewIds.length, Math.trunc(order))) : target.viewIds.length;
  target.viewIds.splice(index, 0, viewId);
  target.activeViewId = viewId;
  return next;
}

export function dockViewBesideGroup(
  layout: ViewGroupLayoutSnapshot,
  viewId: WorkbenchViewId,
  targetGroupId: string,
  newGroupId: string,
  direction: ViewGroupSplitDirection,
  side: "before" | "after",
): ViewGroupLayoutSnapshot {
  if (!layout.groups[targetGroupId] || layout.groups[newGroupId]) return layout;
  const sourceId = sourceGroupId(layout, viewId);
  if (sourceId === targetGroupId && layout.groups[sourceId].viewIds.length < 2) return layout;
  const next = cloneViewGroupLayout(layout);
  if (sourceId) {
    removeView(next.groups[sourceId], viewId);
    if (sourceId !== targetGroupId && next.groups[sourceId].viewIds.length === 0 && Object.keys(next.groups).length > 1) {
      delete next.groups[sourceId];
      const root = removeGroupNode(next.root, sourceId);
      if (root) next.root = root;
    }
  }
  next.root = splitGroupNode(next.root, targetGroupId, newGroupId, direction, side);
  next.groups[newGroupId] = { id: newGroupId, viewIds: [viewId], activeViewId: viewId };
  return next;
}

export function removeViewFromGroupLayout(
  layout: ViewGroupLayoutSnapshot,
  viewId: WorkbenchViewId,
): ViewGroupLayoutSnapshot {
  const groupId = sourceGroupId(layout, viewId);
  if (!groupId) return layout;
  const next = cloneViewGroupLayout(layout);
  removeView(next.groups[groupId], viewId);
  if (next.groups[groupId].viewIds.length === 0 && Object.keys(next.groups).length > 1) {
    delete next.groups[groupId];
    const root = removeGroupNode(next.root, groupId);
    if (root) next.root = root;
  }
  return next;
}

export function closeViewInGroups(
  layout: ViewGroupLayoutSnapshot,
  viewId: WorkbenchViewId,
): ViewGroupLayoutSnapshot {
  const groupId = sourceGroupId(layout, viewId);
  if (!groupId) return layout;
  const next = cloneViewGroupLayout(layout);
  removeView(next.groups[groupId], viewId);
  if (next.groups[groupId].viewIds.length === 0 && Object.keys(next.groups).length > 1) {
    delete next.groups[groupId];
    const root = removeGroupNode(next.root, groupId);
    if (root) next.root = root;
  }
  return next;
}

export function combineViewGroups(
  layout: ViewGroupLayoutSnapshot,
  sourceGroupId: string,
  targetGroupId: string,
): ViewGroupLayoutSnapshot {
  if (sourceGroupId === targetGroupId || !layout.groups[sourceGroupId] || !layout.groups[targetGroupId]) return layout;
  const next = cloneViewGroupLayout(layout);
  const source = next.groups[sourceGroupId];
  const target = next.groups[targetGroupId];
  target.viewIds.push(...source.viewIds.filter((viewId) => !target.viewIds.includes(viewId)));
  target.activeViewId = source.activeViewId ?? target.activeViewId;
  delete next.groups[sourceGroupId];
  next.root = removeGroupNode(next.root, sourceGroupId) ?? { type: "group", groupId: targetGroupId };
  return next;
}
