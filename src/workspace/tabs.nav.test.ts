import { describe, it, expect } from "vitest";
import { emptyTabs, openOrFocus, nextTabId, prevTabId, nthTabId } from "./tabs";

function threeTabs() {
  let s = emptyTabs();
  s = openOrFocus(s, "/a.md", "a");
  s = openOrFocus(s, "/b.md", "b");
  s = openOrFocus(s, "/c.md", "c"); // active = c (last)
  return s;
}

describe("tab navigation", () => {
  it("nextTabId wraps around", () => {
    const s = threeTabs();
    expect(nextTabId(s)).toBe(s.tabs[0].id); // c -> a
  });
  it("prevTabId wraps around", () => {
    const s = threeTabs();
    expect(prevTabId(s)).toBe(s.tabs[1].id); // c -> b
  });
  it("nthTabId is 1-based", () => {
    const s = threeTabs();
    expect(nthTabId(s, 1)).toBe(s.tabs[0].id);
    expect(nthTabId(s, 3)).toBe(s.tabs[2].id);
    expect(nthTabId(s, 9)).toBe(null);
  });
  it("returns null for empty", () => {
    expect(nextTabId(emptyTabs())).toBe(null);
    expect(prevTabId(emptyTabs())).toBe(null);
  });
});
