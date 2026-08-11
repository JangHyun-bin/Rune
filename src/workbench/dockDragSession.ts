import { hitDockZone, toPhysicalScreenRect } from "./dockGeometry";
import { applyDockPlan, planDock } from "./dockTransaction";
import type {
  DockEffect,
  DockPayload,
  DockSurface,
  DockTarget,
  DockWorkspaceSnapshot,
  DockZone,
} from "./dockTypes";

export type DockDragState = "idle" | "armed" | "dragging" | "committing" | "cancelled";

export interface DockDragPreview {
  payload: DockPayload;
  zone: DockZone | null;
  point: { x: number; y: number };
}

export interface DockDragCoordinator {
  state(): DockDragState;
  begin(input: { pointerId: number; payload: DockPayload; client: { x: number; y: number } }): boolean;
  move(input: {
    pointerId: number;
    client: { x: number; y: number };
    screen: { x: number; y: number };
  }): DockZone | null;
  drop(input: { pointerId: number; screen: { x: number; y: number } }): Promise<"committed" | "new-window" | "cancelled" | "ignored">;
  cancel(): boolean;
}

export interface DockDragCoordinatorOptions {
  threshold?: number;
  snapshot(): DockWorkspaceSnapshot;
  surfaces(): DockSurface[];
  preview(value: DockDragPreview | null): void;
  commit(value: {
    snapshot: DockWorkspaceSnapshot;
    effects: DockEffect[];
    payload: DockPayload;
    target: DockTarget;
  }): void | Promise<void>;
  requestNewWindow(payload: DockPayload, point: { x: number; y: number }): void | Promise<void>;
}

function physicalContains(surface: DockSurface, point: { x: number; y: number }): boolean {
  const rects = surface.viewport
    ? [toPhysicalScreenRect(surface.viewport, surface.metrics)]
    : surface.zones.map((zone) => toPhysicalScreenRect(zone.rect, surface.metrics));
  return rects.some((rect) => rect.width > 0 && rect.height > 0
    && point.x >= rect.x && point.x < rect.x + rect.width
    && point.y >= rect.y && point.y < rect.y + rect.height);
}

export function createDockDragCoordinator(options: DockDragCoordinatorOptions): DockDragCoordinator {
  const threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold ?? 5) : 5;
  let dragState: DockDragState = "idle";
  let activePointer: number | null = null;
  let activePayload: DockPayload | null = null;
  let origin = { x: 0, y: 0 };
  let baseRevision = 0;

  const currentSurfaces = (): DockSurface[] => options.surfaces().filter((surface) => surface.revision === baseRevision);
  const zoneAt = (point: { x: number; y: number }): DockZone | null => {
    const matches = currentSurfaces().flatMap((surface) => {
      const zone = hitDockZone(surface, point);
      return zone ? [{ surface, zone }] : [];
    });
    matches.sort((left, right) => right.zone.priority - left.zone.priority
      || left.surface.windowLabel.localeCompare(right.surface.windowLabel)
      || left.zone.id.localeCompare(right.zone.id));
    return matches[0]?.zone ?? null;
  };
  const outsideEverySurface = (point: { x: number; y: number }): boolean =>
    !currentSurfaces().some((surface) => physicalContains(surface, point));
  const clear = (state: DockDragState): void => {
    options.preview(null);
    activePointer = null;
    activePayload = null;
    dragState = state;
  };

  return {
    state: () => dragState,
    begin(input) {
      if (dragState !== "idle" && dragState !== "cancelled") return false;
      activePointer = input.pointerId;
      activePayload = structuredClone(input.payload);
      origin = { ...input.client };
      baseRevision = options.snapshot().revision;
      dragState = "armed";
      return true;
    },
    move(input) {
      if (input.pointerId !== activePointer || !activePayload || (dragState !== "armed" && dragState !== "dragging")) return null;
      if (dragState === "armed") {
        const distance = Math.hypot(input.client.x - origin.x, input.client.y - origin.y);
        if (distance < threshold) return null;
        dragState = "dragging";
      }
      const zone = zoneAt(input.screen);
      options.preview({ payload: structuredClone(activePayload), zone, point: { ...input.screen } });
      return zone;
    },
    async drop(input) {
      if (input.pointerId !== activePointer || !activePayload) return "ignored";
      if (dragState === "armed") {
        clear("idle");
        return "cancelled";
      }
      if (dragState !== "dragging") return "ignored";
      const payload = structuredClone(activePayload);
      const snapshot = options.snapshot();
      if (snapshot.revision !== baseRevision) {
        clear("cancelled");
        return "cancelled";
      }
      const zone = zoneAt(input.screen);
      if (!zone) {
        if (!outsideEverySurface(input.screen)) {
          clear("cancelled");
          return "cancelled";
        }
        dragState = "committing";
        try {
          await options.requestNewWindow(payload, { ...input.screen });
          clear("idle");
          return "new-window";
        } catch {
          clear("cancelled");
          return "cancelled";
        }
      }
      const plan = planDock(snapshot, payload, zone.target);
      if (!plan.ok) {
        clear("cancelled");
        return "cancelled";
      }
      const applied = applyDockPlan(snapshot, plan);
      if (!applied.ok) {
        clear("cancelled");
        return "cancelled";
      }
      dragState = "committing";
      try {
        await options.commit({
          snapshot: applied.snapshot,
          effects: applied.effects,
          payload,
          target: zone.target,
        });
        clear("idle");
        return "committed";
      } catch {
        clear("cancelled");
        return "cancelled";
      }
    },
    cancel() {
      if (dragState !== "armed" && dragState !== "dragging") return false;
      clear("cancelled");
      return true;
    },
  };
}
