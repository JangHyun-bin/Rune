import type { DockPayload } from "./dockTypes";
import type { WorkbenchViewId } from "./workbenchLayout";
import type { ViewWindowTransfer } from "./viewWindowTransfer";

export function detachedDockPayload(
  transfer: ViewWindowTransfer,
  kind: "view" | "group",
  viewId?: WorkbenchViewId,
): DockPayload | null {
  const source = {
    windowLabel: transfer.targetWindowLabel,
    containerId: transfer.sourceContainerId,
    groupId: transfer.group.id,
  };
  if (kind === "view") {
    return viewId && transfer.group.viewIds.includes(viewId) ? { kind, viewId, source } : null;
  }
  if (!transfer.group.activeViewId || transfer.group.viewIds.length === 0) return null;
  return {
    kind,
    viewIds: [...transfer.group.viewIds],
    activeViewId: transfer.group.activeViewId,
    source,
  };
}
