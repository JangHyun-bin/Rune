import { describe, expect, it } from "vitest";
import { adaptiveDropEdgeSize, dropZoneRect, firstMarkdownPath, hitPaneDropZone, physicalToCssPoint } from "./dropTargets";

describe("drop targets", () => {
  it("selects the first Markdown path", () => {
    expect(firstMarkdownPath(["C:/x/a.txt", "C:/x/b.md", "C:/x/c.markdown"])).toBe("C:/x/b.md");
  });

  it("rejects non-Markdown paths", () => {
    expect(firstMarkdownPath(["C:/x/a.txt", "C:/x/b.png"])).toBeNull();
  });

  it("converts physical coordinates to CSS coordinates", () => {
    expect(physicalToCssPoint({ x: 240, y: 120 }, 2)).toEqual({ x: 120, y: 60 });
  });

  it("defaults physical to CSS conversion to a scale of 1", () => {
    expect(physicalToCssPoint({ x: 240, y: 120 })).toEqual({ x: 240, y: 120 });
  });

  it("targets the left edge as a row split before the pane", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 130, y: 180 });
    expect(target).toEqual({ kind: "pane-edge", direction: "row", side: "before" });
  });

  it("targets the bottom edge as a column split after the pane", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 300, y: 335 });
    expect(target).toEqual({ kind: "pane-edge", direction: "column", side: "after" });
  });

  it("targets center when outside edge threshold", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 300, y: 180 });
    expect(target).toEqual({ kind: "pane-center" });
  });

  it("uses wider adaptive split zones on larger panes", () => {
    const target = hitPaneDropZone({ left: 0, top: 0, width: 900, height: 500 }, { x: 300, y: 250 });
    expect(target).toEqual({ kind: "pane-edge", direction: "row", side: "before" });
    expect(adaptiveDropEdgeSize(900)).toBeGreaterThan(300);
  });

  it("keeps the center drop zone usable on narrow panes", () => {
    const edge = adaptiveDropEdgeSize(240);
    expect(edge).toBeLessThan(90);
    expect(240 - edge * 2).toBeGreaterThan(80);
  });

  it("sticks to the previous split target just outside the normal zone", () => {
    const rect = { left: 0, top: 0, width: 900, height: 500 };
    const previous = { kind: "pane-edge" as const, direction: "row" as const, side: "before" as const };
    const point = { x: adaptiveDropEdgeSize(rect.width) + 20, y: 250 };
    expect(hitPaneDropZone(rect, point, { previous })).toEqual(previous);
  });

  it("returns overlay rectangles that match adaptive target zones", () => {
    const rect = { left: 10, top: 20, width: 900, height: 500 };
    const zone = { kind: "pane-edge" as const, direction: "row" as const, side: "after" as const };
    const overlay = dropZoneRect(rect, zone);

    expect(overlay.left).toBeCloseTo(rect.left + rect.width - adaptiveDropEdgeSize(rect.width));
    expect(overlay.top).toBe(rect.top);
    expect(overlay.height).toBe(rect.height);
  });
});
