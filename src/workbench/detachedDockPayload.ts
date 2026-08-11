import type { DockPayload } from "./dockTypes";
import type { WorkbenchViewId } from "./workbenchLayout";
import type { ViewWindowTransfer } from "./viewWindowTransfer";

export function detachedDockPayload(
  transfer: ViewWindowTransfer,
  groupId: string,
  kind: "view" | "group",
  viewId?: WorkbenchViewId,
): DockPayload | null {
  const projected = transfer.groups.find((candidate) => candidate.group.id === groupId);
  if (!projected) return null;
  const source = {
    windowLabel: transfer.targetWindowLabel,
    containerId: projected.containerId,
    groupId: projected.group.id,
  };
  if (kind === "view") {
    return viewId && projected.group.viewIds.includes(viewId) ? { kind, viewId, source } : null;
  }
  if (!projected.group.activeViewId || projected.group.viewIds.length === 0) return null;
  return {
    kind,
    viewIds: [...projected.group.viewIds],
    activeViewId: projected.group.activeViewId,
    source,
  };
}
