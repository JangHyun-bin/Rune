import { describe, expect, it } from "vitest";
import { preventPreviewWidgetEvent, selectionIntersectsSourceRange } from "./previewWidget";

describe("selectionIntersectsSourceRange", () => {
  it("does not treat boundary cursors as inside a preview source range", () => {
    expect(selectionIntersectsSourceRange([{ from: 10, to: 10 }], 10, 20)).toBe(false);
    expect(selectionIntersectsSourceRange([{ from: 20, to: 20 }], 10, 20)).toBe(false);
  });

  it("treats a cursor strictly inside the source range as inside", () => {
    expect(selectionIntersectsSourceRange([{ from: 15, to: 15 }], 10, 20)).toBe(true);
  });

  it("treats non-empty overlapping selections as intersecting", () => {
    expect(selectionIntersectsSourceRange([{ from: 5, to: 11 }], 10, 20)).toBe(true);
    expect(selectionIntersectsSourceRange([{ from: 19, to: 25 }], 10, 20)).toBe(true);
  });

  it("does not treat adjacent selections as intersecting", () => {
    expect(selectionIntersectsSourceRange([{ from: 5, to: 10 }], 10, 20)).toBe(false);
    expect(selectionIntersectsSourceRange([{ from: 20, to: 25 }], 10, 20)).toBe(false);
  });
});

describe("preventPreviewWidgetEvent", () => {
  it("prevents default handling and stops bubbling", () => {
    const calls: string[] = [];
    preventPreviewWidgetEvent({
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    } as Event);

    expect(calls).toEqual(["preventDefault", "stopPropagation"]);
  });
});
