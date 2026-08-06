import { describe, expect, it } from "vitest";
import { normalizeViewWindowTransfer, type ViewWindowTransfer } from "./viewWindowTransfer";

const transfer: ViewWindowTransfer = {
  version: 1,
  transferId: "transfer-1",
  sourceWindowLabel: "main",
  targetWindowLabel: "view-1",
  sourceContainerId: "explorer",
  group: {
    id: "explorer:workspace",
    viewIds: ["workspace", "outline"],
    activeViewId: "outline",
  },
  presentation: {
    theme: "dark",
    uiScale: 1.1,
    locale: "ko",
  },
};

describe("view window transfer", () => {
  it("clones a valid native view-group transfer", () => {
    const normalized = normalizeViewWindowTransfer(structuredClone(transfer));

    expect(normalized).toEqual(transfer);
    expect(normalized).not.toBe(transfer);
    expect(normalized?.group).not.toBe(transfer.group);
  });

  it("rejects duplicate views, invalid active views, labels, and presentation state", () => {
    expect(normalizeViewWindowTransfer({
      ...transfer,
      group: { ...transfer.group, viewIds: ["workspace", "workspace"] },
    })).toBeNull();
    expect(normalizeViewWindowTransfer({
      ...transfer,
      group: { ...transfer.group, activeViewId: "search" },
    })).toBeNull();
    expect(normalizeViewWindowTransfer({ ...transfer, targetWindowLabel: "unsafe label" })).toBeNull();
    expect(normalizeViewWindowTransfer({
      ...transfer,
      presentation: { ...transfer.presentation, uiScale: Number.NaN },
    })).toBeNull();
  });
});
