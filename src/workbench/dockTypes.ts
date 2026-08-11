import type { WorkbenchContainerId, WorkbenchLayoutSnapshot, WorkbenchViewId } from "./workbenchLayout";
import type { ViewWindowLayoutSnapshot, WindowBounds } from "./viewWindowLayout";
import type { NativeDockWindowMetrics } from "./tauriDockDragAdapter";

export interface LogicalRect { left: number; top: number; width: number; height: number }
export interface PhysicalRect { x: number; y: number; width: number; height: number }

export interface DockLocation {
  windowLabel: string;
  containerId: WorkbenchContainerId;
  groupId: string;
}

export type DockPayload =
  | { kind: "view"; viewId: WorkbenchViewId; source: DockLocation }
  | { kind: "group"; viewIds: WorkbenchViewId[]; activeViewId: WorkbenchViewId; source: DockLocation };

export type DockTarget =
  | { kind: "tabs"; windowLabel: string; containerId: WorkbenchContainerId; groupId: string; index: number }
  | { kind: "combine"; windowLabel: string; containerId: WorkbenchContainerId; groupId: string }
  | {
    kind: "split";
    windowLabel: string;
    containerId: WorkbenchContainerId;
    groupId: string;
    direction: "row" | "column";
    side: "before" | "after";
  }
  | { kind: "container"; windowLabel: string; containerId: WorkbenchContainerId; index: number }
  | { kind: "new-window"; bounds: WindowBounds };

export interface DockZone {
  id: string;
  rect: LogicalRect;
  target: DockTarget;
  priority: number;
}

export interface DockSurface {
  windowLabel: string;
  revision: number;
  metrics: NativeDockWindowMetrics;
  viewport?: LogicalRect;
  zones: DockZone[];
}

export interface DockWorkspaceSnapshot {
  revision: number;
  workbench: WorkbenchLayoutSnapshot;
  viewWindows: ViewWindowLayoutSnapshot;
  /** Deprecated runtime mirror retained while Task 6 callers transition to persisted v2 labels. */
  windowLabels?: string[];
}

export type DockEffect =
  | { kind: "close-window"; windowLabel: string }
  | {
    kind: "open-window";
    windowLabel: string;
    containerId: WorkbenchContainerId;
    groupId: string;
    activeViewId: WorkbenchViewId;
    bounds: WindowBounds;
  };

export type DockFailureReason = "invalid-source" | "invalid-target" | "duplicate-view" | "no-op" | "stale-revision";
export interface DockFailure { ok: false; reason: DockFailureReason }

export interface DockPlan {
  ok: true;
  baseRevision: number;
  next: DockWorkspaceSnapshot;
  effects: DockEffect[];
}

export type DockPlanResult = DockPlan | DockFailure;
export type ApplyDockPlanResult =
  | { ok: true; snapshot: DockWorkspaceSnapshot; effects: DockEffect[] }
  | DockFailure;
