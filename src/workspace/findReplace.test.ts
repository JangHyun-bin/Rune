import { describe, expect, it } from "vitest";
import {
  findMatches,
  matchIndexAt,
  nextMatchIndex,
  previousMatchIndex,
  replaceAllText,
} from "./findReplace";

describe("findMatches", () => {
  it("returns no matches for an empty query", () => {
    expect(findMatches("alpha", "")).toEqual([]);
  });

  it("finds case-insensitive ranges by default", () => {
    expect(findMatches("Alpha alpha ALPHA", "alpha")).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ]);
  });

  it("can match case-sensitively", () => {
    expect(findMatches("Alpha alpha ALPHA", "alpha", true)).toEqual([
      { from: 6, to: 11 },
    ]);
  });
});

describe("match navigation", () => {
  const matches = [
    { from: 2, to: 5 },
    { from: 8, to: 11 },
    { from: 14, to: 17 },
  ];

  it("finds the current selected match by exact range", () => {
    expect(matchIndexAt(matches, { from: 8, to: 11 })).toBe(1);
    expect(matchIndexAt(matches, { from: 8, to: 10 })).toBe(-1);
  });

  it("wraps next navigation", () => {
    expect(nextMatchIndex(matches, 7)).toBe(1);
    expect(nextMatchIndex(matches, 17)).toBe(0);
  });

  it("wraps previous navigation", () => {
    expect(previousMatchIndex(matches, 13)).toBe(1);
    expect(previousMatchIndex(matches, 2)).toBe(2);
  });
});

describe("replaceAllText", () => {
  it("replaces ranges in one pass", () => {
    const text = "one two one";
    const matches = findMatches(text, "one");
    expect(replaceAllText(text, matches, "1")).toBe("1 two 1");
  });
});
