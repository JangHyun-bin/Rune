import { describe, expect, it } from "vitest";
import { detachedDockPayload } from "./detachedDockPayload";
import type { ViewWindowTransfer } from "./viewWindowTransfer";

const transfer: ViewWindowTransfer = {
  version: 1,
  transferId: "main:view-3",
  sourceWindowLabel: "main",
  targetWindowLabel: "view-3",
  sourceContainerId: "explorer",
  group: { id: "explorer:workspace", viewIds: ["workspace", "outline"], activeViewId: "outline" },
  presentation: { theme: "dark", uiScale: 1, locale: "en" },
};

describe("detached dock payload", () => {
  it("emits only the dragged tab View", () => {
    expect(detachedDockPayload(transfer, "view", "workspace")).toEqual({
      kind: "view",
      viewId: "workspace",
      source: { windowLabel: "view-3", containerId: "explorer", groupId: "explorer:workspace" },
    });
  });

  it("emits the complete ordered group from the dedicated handle", () => {
    expect(detachedDockPayload(transfer, "group")).toEqual({
      kind: "group",
      viewIds: ["workspace", "outline"],
      activeViewId: "outline",
      source: { windowLabel: "view-3", containerId: "explorer", groupId: "explorer:workspace" },
    });
  });

  it("rejects a tab not owned by the detached group", () => {
    expect(detachedDockPayload(transfer, "view", "search")).toBeNull();
  });
});
