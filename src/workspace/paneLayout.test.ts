import { describe, expect, it } from "vitest";
import {
  createSinglePaneLayout,
  flattenPaneIds,
  removePane,
  splitPane,
  type LayoutNode,
} from "./paneLayout";

describe("pane layout model", () => {
  it("creates a single-pane layout", () => {
    const layout = createSinglePaneLayout("pane-1");
    expect(layout).toEqual({ type: "pane", paneId: "pane-1" });
    expect(flattenPaneIds(layout)).toEqual(["pane-1"]);
  });

  it("splits a pane to the right using row direction", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    expect(layout).toEqual({
      type: "split",
      direction: "row",
      ratios: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1" },
        { type: "pane", paneId: "pane-2" },
      ],
    });
  });

  it("splits a pane above using column direction and before side", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "column",
      side: "before",
      newPaneId: "pane-2",
    });
    expect(layout).toEqual({
      type: "split",
      direction: "column",
      ratios: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-2" },
        { type: "pane", paneId: "pane-1" },
      ],
    });
  });

  it("nests a different split direction", () => {
    const first = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    const second = splitPane(first, {
      sourcePaneId: "pane-2",
      direction: "column",
      side: "after",
      newPaneId: "pane-3",
    });
    expect(second).toEqual({
      type: "split",
      direction: "row",
      ratios: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1" },
        {
          type: "split",
          direction: "column",
          ratios: [0.5, 0.5],
          children: [
            { type: "pane", paneId: "pane-2" },
            { type: "pane", paneId: "pane-3" },
          ],
        },
      ],
    });
    expect(flattenPaneIds(second)).toEqual(["pane-1", "pane-2", "pane-3"]);
    expect((second as Extract<LayoutNode, { type: "split" }>).direction).toBe("row");
  });

  it("preserves split ratios when splitting a descendant", () => {
    const layout: LayoutNode = {
      type: "split",
      direction: "row",
      ratios: [0.8, 0.2],
      children: [
        { type: "pane", paneId: "pane-1" },
        {
          type: "split",
          direction: "column",
          ratios: [0.7, 0.3],
          children: [
            { type: "pane", paneId: "pane-2" },
            { type: "pane", paneId: "pane-3" },
          ],
        },
      ],
    };

    const result = splitPane(layout, {
      sourcePaneId: "pane-3",
      direction: "row",
      side: "after",
      newPaneId: "pane-4",
    });

    expect(result).toEqual({
      type: "split",
      direction: "row",
      ratios: [0.8, 0.2],
      children: [
        { type: "pane", paneId: "pane-1" },
        {
          type: "split",
          direction: "column",
          ratios: [0.7, 0.3],
          children: [
            { type: "pane", paneId: "pane-2" },
            {
              type: "split",
              direction: "row",
              ratios: [0.5, 0.5],
              children: [
                { type: "pane", paneId: "pane-3" },
                { type: "pane", paneId: "pane-4" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("preserves layout and ratios when source pane is not found", () => {
    const layout: LayoutNode = {
      type: "split",
      direction: "row",
      ratios: [0.8, 0.2],
      children: [
        { type: "pane", paneId: "pane-1" },
        { type: "pane", paneId: "pane-2" },
      ],
    };

    const result = splitPane(layout, {
      sourcePaneId: "pane-missing",
      direction: "column",
      side: "after",
      newPaneId: "pane-3",
    });

    expect(result).toBe(layout);
    expect(result).toEqual(layout);
  });

  it("removes a pane and collapses redundant split nodes", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    expect(removePane(layout, "pane-2")).toEqual({ type: "pane", paneId: "pane-1" });
  });

  it("preserves sibling split ratios when removing a pane", () => {
    const layout: LayoutNode = {
      type: "split",
      direction: "row",
      ratios: [0.25, 0.5, 0.25],
      children: [
        { type: "pane", paneId: "pane-1" },
        { type: "pane", paneId: "pane-2" },
        { type: "pane", paneId: "pane-3" },
      ],
    };

    expect(removePane(layout, "pane-2")).toEqual({
      type: "split",
      direction: "row",
      ratios: [0.25, 0.25],
      children: [
        { type: "pane", paneId: "pane-1" },
        { type: "pane", paneId: "pane-3" },
      ],
    });
  });
});
