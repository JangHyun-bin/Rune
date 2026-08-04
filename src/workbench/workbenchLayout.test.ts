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
      sidebarWidth: 320.5,
      outlineHeight: 176.25,
    });
    expect(state.parts.primarySidebar.size).toBe(321);
    expect(state.views.outline.size).toBe(176);
  });

  it("normalizes persisted and mutated sizes to integer pixels", () => {
    const persisted = {
      ...DEFAULT_WORKBENCH_LAYOUT,
      parts: {
        ...DEFAULT_WORKBENCH_LAYOUT.parts,
        primarySidebar: { ...DEFAULT_WORKBENCH_LAYOUT.parts.primarySidebar, size: 320.5 },
      },
      views: {
        ...DEFAULT_WORKBENCH_LAYOUT.views,
        outline: { ...DEFAULT_WORKBENCH_LAYOUT.views.outline, size: 176.25 },
      },
    };

    const normalized = normalizeWorkbenchLayout(persisted);

    expect(normalized.parts.primarySidebar.size).toBe(321);
    expect(normalized.views.outline.size).toBe(176);
    expect(setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 320.5).parts.primarySidebar.size).toBe(321);
  });

  it("recovers from malformed and unsupported snapshots", () => {
    expect(normalizeWorkbenchLayout({ version: 99 })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(normalizeWorkbenchLayout({ version: 1, parts: null })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("migrates an older valid layout by adding new auxiliary views", () => {
    const legacy = {
      ...DEFAULT_WORKBENCH_LAYOUT,
      parts: {
        ...DEFAULT_WORKBENCH_LAYOUT.parts,
        primarySidebar: { ...DEFAULT_WORKBENCH_LAYOUT.parts.primarySidebar, size: 333 },
      },
      views: {
        workspace: DEFAULT_WORKBENCH_LAYOUT.views.workspace,
        outline: DEFAULT_WORKBENCH_LAYOUT.views.outline,
        search: DEFAULT_WORKBENCH_LAYOUT.views.search,
      },
    };

    const migrated = normalizeWorkbenchLayout(legacy);

    expect(migrated.parts.primarySidebar.size).toBe(333);
    expect(migrated.views.backlinks).toMatchObject({ containerId: "auxiliary", visible: true });
    expect(migrated.views.properties).toMatchObject({ containerId: "auxiliary", visible: true });
    expect(migrated.views.tags).toMatchObject({ containerId: "explorer", visible: true });
    expect(migrated.views.project).toMatchObject({ containerId: "explorer", visible: true });
  });

  it("rejects a part whose active container belongs to another part", () => {
    const invalid = {
      ...DEFAULT_WORKBENCH_LAYOUT,
      parts: {
        ...DEFAULT_WORKBENCH_LAYOUT.parts,
        primarySidebar: { ...DEFAULT_WORKBENCH_LAYOUT.parts.primarySidebar, activeContainerId: "panel" },
      },
    };
    expect(normalizeWorkbenchLayout(invalid)).toEqual(DEFAULT_WORKBENCH_LAYOUT);
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
