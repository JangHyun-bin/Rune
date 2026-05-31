import { describe, it, expect } from "vitest";
import { emptyTabs, openOrFocus, newUntitled, activeTab, updateActiveText, markActiveSaved, closeTab, tabDirty } from "./tabs";

describe("tabs model", () => {
  it("openOrFocus adds and activates a tab", () => {
    const s = openOrFocus(emptyTabs(), "/a.md", "A");
    expect(s.tabs.length).toBe(1);
    expect(activeTab(s)!.path).toBe("/a.md");
    expect(tabDirty(activeTab(s)!)).toBe(false);
  });
  it("opening the same path focuses the existing tab (no duplicate)", () => {
    let s = openOrFocus(emptyTabs(), "/a.md", "A");
    s = openOrFocus(s, "/b.md", "B");
    s = openOrFocus(s, "/a.md", "A");
    expect(s.tabs.length).toBe(2);
    expect(activeTab(s)!.path).toBe("/a.md");
  });
  it("updateActiveText makes the active tab dirty; markActiveSaved clears it", () => {
    let s = openOrFocus(emptyTabs(), "/a.md", "A");
    s = updateActiveText(s, "A edited");
    expect(tabDirty(activeTab(s)!)).toBe(true);
    s = markActiveSaved(s, "/a.md", "A edited");
    expect(tabDirty(activeTab(s)!)).toBe(false);
  });
  it("newUntitled adds an empty active tab with null path", () => {
    const s = newUntitled(emptyTabs());
    expect(activeTab(s)!.path).toBeNull();
  });
  it("closeTab removes and activates a neighbor; closing last leaves null", () => {
    let s = openOrFocus(emptyTabs(), "/a.md", "A");
    s = openOrFocus(s, "/b.md", "B");
    const aId = s.tabs[0].id;
    s = closeTab(s, s.activeId!);
    expect(s.tabs.length).toBe(1);
    expect(s.activeId).toBe(aId);
    s = closeTab(s, aId);
    expect(s.tabs.length).toBe(0);
    expect(s.activeId).toBeNull();
  });
});
