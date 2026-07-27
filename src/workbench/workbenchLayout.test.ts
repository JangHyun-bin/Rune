import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  activateContainer,
  closeView,
  normalizeWorkbenchLayout,
  openView,
  resetViewVisibility,
  setPartSize,
  toggleViewCollapsed,
} from "./workbenchLayout";

describe("workbench layout", () => {
  it("migrates legacy sidebar and outline sizes", () => {
    const state = normalizeWorkbenchLayout(null, {
      sidebarWidth: 318,
      outlineHeight: 176,
    });
    expect(state.parts.primarySidebar.size).toBe(318);
    expect(state.views.outline.size).toBe(176);
  });

  it("recovers from malformed and unsupported snapshots", () => {
    expect(normalizeWorkbenchLayout({ version: 99 })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(normalizeWorkbenchLayout({ version: 1, parts: null })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("closes and reopens a view without changing its container", () => {
    const closed = closeView(DEFAULT_WORKBENCH_LAYOUT, "outline");
    expect(closed.views.outline.visible).toBe(false);
    const reopened = openView(closed, "outline");
    expect(reopened.views.outline).toMatchObject({
      containerId: "explorer",
      visible: true,
    });
    expect(reopened.parts.primarySidebar.visible).toBe(true);
    expect(reopened.parts.primarySidebar.activeContainerId).toBe("explorer");
  });

  it("collapses a visible view without closing it", () => {
    const state = toggleViewCollapsed(DEFAULT_WORKBENCH_LAYOUT, "outline");
    expect(state.views.outline.visible).toBe(true);
    expect(state.views.outline.collapsed).toBe(true);
  });

  it("activates Search and opens the Primary Sidebar", () => {
    const state = activateContainer(DEFAULT_WORKBENCH_LAYOUT, "search");
    expect(state.parts.primarySidebar).toMatchObject({
      visible: true,
      activeContainerId: "search",
    });
  });

  it("clamps persisted part sizes", () => {
    expect(setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 20).parts.primarySidebar.size).toBe(96);
    expect(setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 9000).parts.primarySidebar.size).toBe(720);
  });

  it("resets visibility without resetting sizes or locations", () => {
    const resized = setPartSize(closeView(DEFAULT_WORKBENCH_LAYOUT, "outline"), "primarySidebar", 360);
    const reset = resetViewVisibility(resized);
    expect(reset.views.outline).toMatchObject({ visible: true, collapsed: false });
    expect(reset.parts.primarySidebar.size).toBe(360);
    expect(reset.views.outline.containerId).toBe("explorer");
  });
});
