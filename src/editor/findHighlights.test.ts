import { describe, expect, it } from "vitest";
import { findHighlightSpecs } from "./findHighlights";

describe("findHighlightSpecs", () => {
  it("marks every match and the active match distinctly", () => {
    expect(findHighlightSpecs([
      { from: 0, to: 5 },
      { from: 12, to: 17 },
    ], 1)).toEqual([
      { from: 0, to: 5, className: "cm-find-match" },
      { from: 12, to: 17, className: "cm-find-match cm-find-match-active" },
    ]);
  });

  it("keeps matches highlighted when no active match is selected", () => {
    expect(findHighlightSpecs([{ from: 3, to: 7 }], -1)).toEqual([
      { from: 3, to: 7, className: "cm-find-match" },
    ]);
  });
});
