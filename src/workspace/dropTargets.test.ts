import { describe, expect, it } from "vitest";
import { firstMarkdownPath, hitPaneDropZone, physicalToCssPoint } from "./dropTargets";

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
});
