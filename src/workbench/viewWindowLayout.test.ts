import { describe, expect, it } from "vitest";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";
import { normalizeViewWindowLayout, recoverWindowBounds, type ViewWindowLayoutSnapshot } from "./viewWindowLayout";

const saved: ViewWindowLayoutSnapshot = {
  version: 1,
  sessionState: "running",
  windows: [{
    containerId: "explorer",
    groupId: "explorer:outline",
    activeViewId: "outline",
    bounds: { x: 2200, y: 120, width: 900, height: 700 },
    monitor: { name: "Secondary", scaleFactor: 1.5, x: 1920, y: 0, width: 2560, height: 1440 },
  }],
};

describe("multi-window layout persistence", () => {
  it("accepts only live unique View groups and recovers corruption to an empty snapshot", () => {
    expect(normalizeViewWindowLayout(saved, DEFAULT_WORKBENCH_LAYOUT)).toEqual(saved);
    expect(normalizeViewWindowLayout({ ...saved, windows: [saved.windows[0], saved.windows[0]] }, DEFAULT_WORKBENCH_LAYOUT).windows).toHaveLength(1);
    expect(normalizeViewWindowLayout({ ...saved, version: 99 }, DEFAULT_WORKBENCH_LAYOUT)).toEqual({ version: 1, sessionState: "clean", windows: [] });
    expect(normalizeViewWindowLayout({ ...saved, windows: [{ ...saved.windows[0], groupId: "missing" }] }, DEFAULT_WORKBENCH_LAYOUT).windows).toEqual([]);
  });

  it("moves an unavailable monitor window onto the primary work area", () => {
    expect(recoverWindowBounds(saved.windows[0], [{
      name: "Primary", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }], "Primary")).toEqual({ x: 187, y: 80, width: 600, height: 467 });
  });

  it("rescales for DPI changes and clamps the full window into the target work area", () => {
    const result = recoverWindowBounds(saved.windows[0], [{
      name: "Secondary", scaleFactor: 2, workArea: { x: 1920, y: 0, width: 1600, height: 900 },
    }], "Secondary");
    expect(result).toEqual({ x: 2293, y: 0, width: 1200, height: 900 });
  });
});
