import { describe, expect, it } from "vitest";
import { decodeViewDrag, encodeViewDrag, insertionIndex } from "./viewDrop";

describe("view drop payloads", () => {
  it("accepts only draggable view ids", () => {
    expect(decodeViewDrag(encodeViewDrag("workspace"))).toBe("workspace");
    expect(decodeViewDrag(encodeViewDrag("outline"))).toBe("outline");
    expect(decodeViewDrag(encodeViewDrag("search"))).toBe("search");
  });

  it("rejects non-view payloads", () => {
    for (const value of ["", '{"id":"workspace"}', "notes/today.md", "properties", "anything-else"]) {
      expect(decodeViewDrag(value)).toBeNull();
    }
  });
});

describe("view drop insertion", () => {
  it("places a pointer before, between, or after visible headers", () => {
    expect(insertionIndex([20, 60, 100], 10)).toBe(0);
    expect(insertionIndex([20, 60, 100], 75)).toBe(2);
    expect(insertionIndex([20, 60, 100], 120)).toBe(3);
  });
});
