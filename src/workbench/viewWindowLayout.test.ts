import { describe, expect, it } from "vitest";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";
import {
  normalizeCapturedWindowBounds,
  normalizeViewWindowLayout,
  recoverWindowBounds,
  type ViewWindowLayoutSnapshot,
} from "./viewWindowLayout";

const bounds = { x: 2200, y: 120, width: 900, height: 700 };
const monitor = { name: "Secondary", scaleFactor: 1.5, x: 1920, y: 0, width: 2560, height: 1440 };
const saved: ViewWindowLayoutSnapshot = {
  version: 2,
  sessionState: "running",
  windows: [{
    label: "view-3",
    groups: [
      { containerId: "explorer", groupId: "explorer:workspace" },
      { containerId: "explorer", groupId: "explorer:outline" },
    ],
    root: {
      type: "split",
      direction: "column",
      children: [
        { type: "group", groupId: "explorer:workspace" },
        { type: "group", groupId: "explorer:outline" },
      ],
      ratios: [0.4, 0.6],
    },
    activeGroupId: "explorer:outline",
    activeViewId: "outline",
    bounds,
    monitor,
  }],
};

describe("multi-window layout persistence", () => {
  it("preserves stable labels, ordered group references, the group tree, and active selections", () => {
    expect(normalizeViewWindowLayout(saved, DEFAULT_WORKBENCH_LAYOUT)).toEqual(saved);
  });

  it("migrates version 1 deterministically to one group per stable window label", () => {
    expect(normalizeViewWindowLayout({
      version: 1,
      sessionState: "clean",
      windows: [{
        containerId: "explorer",
        groupId: "explorer:outline",
        activeViewId: "outline",
        bounds,
        monitor,
      }],
    }, DEFAULT_WORKBENCH_LAYOUT)).toEqual({
      version: 2,
      sessionState: "clean",
      windows: [{
        label: "view-1",
        groups: [{ containerId: "explorer", groupId: "explorer:outline" }],
        root: { type: "group", groupId: "explorer:outline" },
        activeGroupId: "explorer:outline",
        activeViewId: "outline",
        bounds,
        monitor,
      }],
    });
  });

  it("keeps one authoritative owner when windows repeat a group or label", () => {
    const duplicate = structuredClone(saved);
    duplicate.windows.push({
      ...structuredClone(saved.windows[0]),
      label: "view-4",
      groups: [{ containerId: "explorer", groupId: "explorer:outline" }],
      root: { type: "group", groupId: "explorer:outline" },
    });
    duplicate.windows.push({
      ...structuredClone(saved.windows[0]),
      groups: [{ containerId: "explorer", groupId: "explorer:workspace" }],
      root: { type: "group", groupId: "explorer:workspace" },
      activeGroupId: "explorer:workspace",
      activeViewId: "workspace",
    });
    expect(normalizeViewWindowLayout(duplicate, DEFAULT_WORKBENCH_LAYOUT).windows).toEqual([saved.windows[0]]);
  });

  it("drops only invalid window projections for missing groups, malformed bounds, and invalid trees", () => {
    const invalid = structuredClone(saved);
    invalid.windows.push({
      ...structuredClone(saved.windows[0]),
      label: "view-4",
      groups: [{ containerId: "explorer", groupId: "missing" }],
      root: { type: "group", groupId: "missing" },
      activeGroupId: "missing",
    });
    invalid.windows.push({
      ...structuredClone(saved.windows[0]),
      label: "view-5",
      groups: [{ containerId: "search", groupId: "search:search" }],
      root: { type: "group", groupId: "search:search" },
      activeGroupId: "search:search",
      activeViewId: "search",
      bounds: { ...bounds, width: Number.NaN },
    });
    invalid.windows.push({
      ...structuredClone(saved.windows[0]),
      label: "view-6",
      groups: [{ containerId: "auxiliary", groupId: "auxiliary:backlinks" }],
      root: {
        type: "split",
        direction: "row",
        children: [
          { type: "group", groupId: "auxiliary:backlinks" },
          { type: "group", groupId: "auxiliary:backlinks" },
        ],
        ratios: [0.5, 0.5],
      },
      activeGroupId: "auxiliary:backlinks",
      activeViewId: "backlinks",
    });
    expect(normalizeViewWindowLayout(invalid, DEFAULT_WORKBENCH_LAYOUT).windows).toEqual([saved.windows[0]]);
  });

  it("rejects cyclic trees, unsupported versions, and ignores interrupted transaction data", () => {
    const cyclic: Record<string, unknown> = { type: "split", direction: "row", ratios: [0.5, 0.5] };
    cyclic.children = [{ type: "group", groupId: "explorer:workspace" }, cyclic];
    const interrupted = structuredClone(saved) as unknown as Record<string, unknown>;
    interrupted.transaction = { sessionId: "stale", state: "committing" };
    expect(normalizeViewWindowLayout(interrupted, DEFAULT_WORKBENCH_LAYOUT)).toEqual(saved);
    expect(normalizeViewWindowLayout({
      ...saved,
      windows: [{ ...saved.windows[0], root: cyclic }],
    }, DEFAULT_WORKBENCH_LAYOUT).windows).toEqual([]);
    expect(normalizeViewWindowLayout({ ...saved, version: 99 }, DEFAULT_WORKBENCH_LAYOUT)).toEqual({
      version: 2,
      sessionState: "clean",
      windows: [],
    });
  });

  it("recovers duplicate Views by rejecting their duplicate window ownership", () => {
    const duplicateViews = structuredClone(DEFAULT_WORKBENCH_LAYOUT);
    duplicateViews.viewGroups.explorer.groups["explorer:outline"].viewIds.push("workspace");
    expect(normalizeViewWindowLayout(saved, duplicateViews).windows).toEqual([]);
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

  it("falls back to the requested size while a native window reports zero geometry", () => {
    expect(normalizeCapturedWindowBounds(
      { x: 0, y: 0 },
      { width: 0, height: 0 },
      { width: 420, height: 640 },
    )).toEqual({ x: 0, y: 0, width: 420, height: 640 });
    expect(normalizeCapturedWindowBounds(
      { x: 25, y: 40 },
      { width: 800, height: 600 },
      { width: 420, height: 640 },
    )).toEqual({ x: 25, y: 40, width: 800, height: 600 });
  });
});
