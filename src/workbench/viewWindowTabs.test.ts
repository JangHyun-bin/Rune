import { describe, expect, it } from "vitest";
import { nextDetachedTabIndex } from "./viewWindowTabs";

describe("detached View tab keyboard navigation", () => {
  it("wraps arrows and supports Home and End", () => {
    expect(nextDetachedTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextDetachedTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextDetachedTabIndex(1, 3, "Home")).toBe(0);
    expect(nextDetachedTabIndex(1, 3, "End")).toBe(2);
    expect(nextDetachedTabIndex(1, 3, "Enter")).toBeNull();
  });
});
