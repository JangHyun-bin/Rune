import type { WorkbenchContainerId, WorkbenchViewId } from "./workbenchLayout";

export const VIEW_DRAG_TYPE = "application/x-rune-workbench-view";

export interface ViewDropTarget {
  containerId: WorkbenchContainerId;
  order: number;
}

const draggableViewIds = new Set<WorkbenchViewId>([
  "workspace", "outline", "tags", "project", "search", "backlinks", "properties", "references",
]);

export function encodeViewDrag(id: WorkbenchViewId): string {
  return id;
}

export function decodeViewDrag(value: string): WorkbenchViewId | null {
  return draggableViewIds.has(value as WorkbenchViewId) ? value as WorkbenchViewId : null;
}

export function insertionIndex(midpoints: number[], pointer: number): number {
  const index = midpoints.findIndex((midpoint) => pointer < midpoint);
  return index < 0 ? midpoints.length : index;
}
