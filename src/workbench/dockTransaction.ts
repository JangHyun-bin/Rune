import type {
  ApplyDockPlanResult,
  DockEffect,
  DockFailure,
  DockLocation,
  DockPayload,
  DockPlan,
  DockPlanResult,
  DockTarget,
  DockWorkspaceSnapshot,
} from "./dockTypes";
import { viewGroupIdForView } from "./viewGroupLayout";
import {
  activateViewGroup,
  moveView,
  moveViewToWorkbenchGroup,
  splitWorkbenchViewGroup,
  type WorkbenchContainerId,
  type WorkbenchLayoutSnapshot,
  type WorkbenchViewId,
} from "./workbenchLayout";
import type { PersistedViewWindow, ViewWindowLayoutSnapshot, WindowBounds } from "./viewWindowLayout";

const failure = (reason: DockFailure["reason"]): DockFailure => ({ ok: false, reason });

function windowIndex(label: string): number | null {
  const match = /^view-([1-9]\d*)$/.exec(label);
  return match ? Number(match[1]) - 1 : null;
}

function detachedIndex(snapshot: DockWorkspaceSnapshot, containerId: WorkbenchContainerId, groupId: string): number {
  return snapshot.viewWindows.windows.findIndex((item) => item.containerId === containerId && item.groupId === groupId);
}

function nativeWindowLabels(snapshot: DockWorkspaceSnapshot): string[] {
  if (snapshot.windowLabels?.length === snapshot.viewWindows.windows.length
    && new Set(snapshot.windowLabels).size === snapshot.windowLabels.length
    && snapshot.windowLabels.every((label) => windowIndex(label) !== null)) return [...snapshot.windowLabels];
  return snapshot.viewWindows.windows.map((_, index) => `view-${index + 1}`);
}

function locationMatchesWindow(snapshot: DockWorkspaceSnapshot, location: DockLocation): boolean {
  const index = detachedIndex(snapshot, location.containerId, location.groupId);
  if (location.windowLabel === "main") return index === -1;
  return index >= 0 && nativeWindowLabels(snapshot)[index] === location.windowLabel;
}

function viewIds(payload: DockPayload): WorkbenchViewId[] {
  return payload.kind === "view" ? [payload.viewId] : payload.viewIds;
}

function hasDuplicateViews(workbench: WorkbenchLayoutSnapshot): boolean {
  const seen = new Set<WorkbenchViewId>();
  for (const layout of Object.values(workbench.viewGroups)) {
    for (const group of Object.values(layout.groups)) {
      for (const viewId of group.viewIds) {
        if (seen.has(viewId)) return true;
        seen.add(viewId);
      }
    }
  }
  return false;
}

function validPayload(snapshot: DockWorkspaceSnapshot, payload: DockPayload): boolean {
  const source = snapshot.workbench.viewGroups[payload.source.containerId]?.groups[payload.source.groupId];
  if (!source || !locationMatchesWindow(snapshot, payload.source)) return false;
  if (payload.kind === "view") {
    return source.viewIds.includes(payload.viewId)
      && snapshot.workbench.views[payload.viewId]?.containerId === payload.source.containerId;
  }
  return payload.viewIds.length > 0
    && new Set(payload.viewIds).size === payload.viewIds.length
    && payload.viewIds.includes(payload.activeViewId)
    && payload.viewIds.length === source.viewIds.length
    && payload.viewIds.every((viewId, index) => viewId === source.viewIds[index])
    && payload.viewIds.every((viewId) => snapshot.workbench.views[viewId]?.containerId === payload.source.containerId);
}

function validBounds(bounds: WindowBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width >= 200 && bounds.height >= 120 && bounds.width <= 20_000 && bounds.height <= 20_000;
}

function validTarget(snapshot: DockWorkspaceSnapshot, target: DockTarget): boolean {
  if (target.kind === "new-window") return validBounds(target.bounds);
  const container = snapshot.workbench.viewGroups[target.containerId];
  if (!container) return false;
  if (target.kind === "container") {
    return target.windowLabel === "main" && Number.isInteger(target.index) && target.index >= 0;
  }
  const group = container.groups[target.groupId];
  if (!group) return false;
  const location = { windowLabel: target.windowLabel, containerId: target.containerId, groupId: target.groupId };
  if (!locationMatchesWindow(snapshot, location)) return false;
  if (target.kind === "tabs") return Number.isInteger(target.index) && target.index >= 0 && target.index <= group.viewIds.length;
  if (target.kind === "split") {
    return (target.direction === "row" || target.direction === "column")
      && (target.side === "before" || target.side === "after");
  }
  return true;
}

function freshGroupId(workbench: WorkbenchLayoutSnapshot, containerId: WorkbenchContainerId, seed: string): string {
  const groups = workbench.viewGroups[containerId].groups;
  let candidate = `${containerId}:dock:${seed}`;
  let suffix = 2;
  while (groups[candidate]) candidate = `${containerId}:dock:${seed}:${suffix++}`;
  return candidate;
}

function moveViewsToGroup(
  workbench: WorkbenchLayoutSnapshot,
  ids: WorkbenchViewId[],
  activeViewId: WorkbenchViewId,
  containerId: WorkbenchContainerId,
  groupId: string,
  index: number,
): WorkbenchLayoutSnapshot {
  let next = workbench;
  ids.forEach((viewId, offset) => {
    next = moveViewToWorkbenchGroup(next, viewId, containerId, groupId, index + offset);
  });
  return activateViewGroup(next, containerId, groupId, activeViewId);
}

function dockAtExistingTarget(
  workbench: WorkbenchLayoutSnapshot,
  payload: DockPayload,
  target: Exclude<DockTarget, { kind: "new-window" | "container" }>,
): WorkbenchLayoutSnapshot {
  const ids = viewIds(payload);
  const active = payload.kind === "group" ? payload.activeViewId : payload.viewId;
  if (target.kind === "tabs" || target.kind === "combine") {
    const targetLength = workbench.viewGroups[target.containerId].groups[target.groupId].viewIds.length;
    const index = target.kind === "tabs" ? target.index : targetLength;
    return moveViewsToGroup(workbench, ids, active, target.containerId, target.groupId, index);
  }

  const newGroupId = freshGroupId(workbench, target.containerId, ids.join("-"));
  let next = splitWorkbenchViewGroup(
    workbench,
    ids[0],
    target.containerId,
    target.groupId,
    newGroupId,
    target.direction,
    target.side,
  );
  if (viewGroupIdForView(next.viewGroups[target.containerId], ids[0]) !== newGroupId) return workbench;
  for (const viewId of ids.slice(1)) {
    next = moveViewToWorkbenchGroup(next, viewId, target.containerId, newGroupId);
  }
  return activateViewGroup(next, target.containerId, newGroupId, active);
}

function dockAtContainer(
  workbench: WorkbenchLayoutSnapshot,
  payload: DockPayload,
  target: Extract<DockTarget, { kind: "container" }>,
): WorkbenchLayoutSnapshot {
  const ids = viewIds(payload);
  const active = payload.kind === "group" ? payload.activeViewId : payload.viewId;
  let next = moveView(workbench, ids[0], target.containerId, target.index);
  const groupId = viewGroupIdForView(next.viewGroups[target.containerId], ids[0]);
  if (!groupId) return workbench;
  for (const viewId of ids.slice(1)) next = moveViewToWorkbenchGroup(next, viewId, target.containerId, groupId);
  return activateViewGroup(next, target.containerId, groupId, active);
}

function reconcileWindows(
  original: DockWorkspaceSnapshot,
  workbench: WorkbenchLayoutSnapshot,
): { viewWindows: ViewWindowLayoutSnapshot; windowLabels: string[]; effects: DockEffect[] } {
  const effects: DockEffect[] = [];
  const windows: PersistedViewWindow[] = [];
  const labels = nativeWindowLabels(original);
  const windowLabels: string[] = [];
  original.viewWindows.windows.forEach((window, index) => {
    const group = workbench.viewGroups[window.containerId]?.groups[window.groupId];
    if (!group || group.viewIds.length === 0) {
      effects.push({ kind: "close-window", windowLabel: labels[index] });
      return;
    }
    windowLabels.push(labels[index]);
    windows.push({
      ...structuredClone(window),
      activeViewId: group.activeViewId ?? group.viewIds[0],
    });
  });
  return {
    viewWindows: { ...structuredClone(original.viewWindows), windows },
    windowLabels,
    effects,
  };
}

function nextWindowLabel(labels: string[]): string {
  const highest = labels.reduce((maximum, label) => Math.max(maximum, (windowIndex(label) ?? -1) + 1), 0);
  return `view-${highest + 1}`;
}

function extractToNewWindow(
  snapshot: DockWorkspaceSnapshot,
  payload: DockPayload,
  bounds: WindowBounds,
): { workbench: WorkbenchLayoutSnapshot; window: PersistedViewWindow } | null {
  if (payload.source.windowLabel !== "main") return null;
  const active = payload.kind === "group" ? payload.activeViewId : payload.viewId;
  let workbench = snapshot.workbench;
  let groupId = payload.source.groupId;
  if (payload.kind === "view" && snapshot.workbench.viewGroups[payload.source.containerId].groups[groupId].viewIds.length > 1) {
    const newGroupId = freshGroupId(workbench, payload.source.containerId, payload.viewId);
    workbench = splitWorkbenchViewGroup(
      workbench,
      payload.viewId,
      payload.source.containerId,
      groupId,
      newGroupId,
      "row",
      "after",
    );
    groupId = newGroupId;
  }
  return {
    workbench: activateViewGroup(workbench, payload.source.containerId, groupId, active),
    window: {
      containerId: payload.source.containerId,
      groupId,
      activeViewId: active,
      bounds: structuredClone(bounds),
      monitor: { name: null, scaleFactor: 1, ...structuredClone(bounds) },
    },
  };
}

function sameSnapshot(left: DockWorkspaceSnapshot, right: DockWorkspaceSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function planDock(snapshot: DockWorkspaceSnapshot, payload: DockPayload, target: DockTarget): DockPlanResult {
  if (hasDuplicateViews(snapshot.workbench)) return failure("duplicate-view");
  if (!validPayload(snapshot, payload)) return failure("invalid-source");
  if (!validTarget(snapshot, target)) return failure("invalid-target");

  let workbench: WorkbenchLayoutSnapshot;
  let reconciled: ReturnType<typeof reconcileWindows>;
  if (target.kind === "new-window") {
    const extracted = extractToNewWindow(snapshot, payload, target.bounds);
    if (!extracted) return failure("no-op");
    workbench = extracted.workbench;
    reconciled = reconcileWindows(snapshot, workbench);
    const windowLabel = nextWindowLabel(reconciled.windowLabels);
    reconciled.viewWindows.windows.push(extracted.window);
    reconciled.windowLabels.push(windowLabel);
    reconciled.effects.push({
      kind: "open-window",
      windowLabel,
      containerId: extracted.window.containerId,
      groupId: extracted.window.groupId,
      activeViewId: extracted.window.activeViewId,
      bounds: structuredClone(target.bounds),
    });
  } else if (target.kind === "container") {
    if (payload.source.containerId === target.containerId) return failure("no-op");
    workbench = dockAtContainer(snapshot.workbench, payload, target);
    reconciled = reconcileWindows(snapshot, workbench);
  } else {
    if (payload.kind === "group"
      && payload.source.containerId === target.containerId
      && payload.source.groupId === target.groupId) return failure("no-op");
    workbench = dockAtExistingTarget(snapshot.workbench, payload, target);
    reconciled = reconcileWindows(snapshot, workbench);
  }

  const next: DockWorkspaceSnapshot = {
    revision: snapshot.revision,
    workbench,
    viewWindows: reconciled.viewWindows,
    ...(snapshot.windowLabels || target.kind === "new-window" ? { windowLabels: reconciled.windowLabels } : {}),
  };
  if (sameSnapshot(snapshot, next)) return failure("no-op");
  return { ok: true, baseRevision: snapshot.revision, next, effects: reconciled.effects };
}

export function applyDockPlan(snapshot: DockWorkspaceSnapshot, plan: DockPlan): ApplyDockPlanResult {
  if (snapshot.revision !== plan.baseRevision) return failure("stale-revision");
  const next = structuredClone(plan.next);
  next.revision = snapshot.revision + 1;
  return { ok: true, snapshot: next, effects: structuredClone(plan.effects) };
}
