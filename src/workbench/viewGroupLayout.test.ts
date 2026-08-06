import { describe, expect, it } from "vitest";
import {
  closeViewInGroups,
  combineViewGroups,
  createDefaultViewGroupLayouts,
  createViewGroupLayout,
  dockViewBesideGroup,
  groupIdsInViewGroupLayout,
  moveViewToGroup,
  normalizeViewGroupLayout,
  splitViewGroup,
} from "./viewGroupLayout";
import { DEFAULT_WORKBENCH_LAYOUT, closeView, moveView } from "./workbenchLayout";

describe("view group layout", () => {
  it("splits one view into a nested group and combines it back", () => {
    const initial = createViewGroupLayout("group-1", ["workspace", "outline"], "outline");
    const split = splitViewGroup(initial, {
      sourceGroupId: "group-1",
      newGroupId: "group-2",
      viewId: "outline",
      direction: "row",
      side: "after",
    });

    expect(split).toEqual({
      version: 1,
      root: {
        type: "split",
        direction: "row",
        ratios: [0.5, 0.5],
        children: [
          { type: "group", groupId: "group-1" },
          { type: "group", groupId: "group-2" },
        ],
      },
      groups: {
        "group-1": { id: "group-1", viewIds: ["workspace"], activeViewId: "workspace" },
        "group-2": { id: "group-2", viewIds: ["outline"], activeViewId: "outline" },
      },
    });

    expect(combineViewGroups(split, "group-2", "group-1")).toEqual({
      version: 1,
      root: { type: "group", groupId: "group-1" },
      groups: {
        "group-1": { id: "group-1", viewIds: ["workspace", "outline"], activeViewId: "outline" },
      },
    });
  });

  it("moves and reorders a view without duplicating it", () => {
    const initial = splitViewGroup(
      createViewGroupLayout("group-1", ["workspace", "outline", "search"]),
      {
        sourceGroupId: "group-1",
        newGroupId: "group-2",
        viewId: "search",
        direction: "column",
        side: "after",
      },
    );

    const moved = moveViewToGroup(initial, "outline", "group-2", 0);
    const reordered = moveViewToGroup(moved, "search", "group-2", 0);

    expect(reordered.groups["group-1"]).toEqual({ id: "group-1", viewIds: ["workspace"], activeViewId: "workspace" });
    expect(reordered.groups["group-2"]).toEqual({ id: "group-2", viewIds: ["search", "outline"], activeViewId: "search" });
    expect(Object.values(reordered.groups).flatMap(({ viewIds }) => viewIds).sort()).toEqual(["outline", "search", "workspace"]);
  });

  it("closes an empty group safely and can reopen the view in another group", () => {
    const split = splitViewGroup(
      createViewGroupLayout("group-1", ["workspace", "outline"]),
      {
        sourceGroupId: "group-1",
        newGroupId: "group-2",
        viewId: "outline",
        direction: "row",
        side: "after",
      },
    );

    const closed = closeViewInGroups(split, "outline");
    expect(closed.root).toEqual({ type: "group", groupId: "group-1" });
    expect(closed.groups["group-2"]).toBeUndefined();

    const reopened = moveViewToGroup(closed, "outline", "group-1", 0);
    expect(reopened.groups["group-1"]).toEqual({
      id: "group-1",
      viewIds: ["outline", "workspace"],
      activeViewId: "outline",
    });
  });

  it("migrates existing sidebar stacks and panel tabs without losing closed views", () => {
    const legacy = closeView(moveView(DEFAULT_WORKBENCH_LAYOUT, "outline", "panel"), "tags");

    const layouts = createDefaultViewGroupLayouts(legacy);

    expect(layouts.explorer.root).toEqual({
      type: "split",
      direction: "column",
      ratios: [1 / 3, 1 / 3, 1 / 3],
      children: [
        { type: "group", groupId: "explorer:workspace" },
        { type: "group", groupId: "explorer:tags" },
        { type: "group", groupId: "explorer:project" },
      ],
    });
    expect(layouts.panel.groups["panel:main"]).toEqual({
      id: "panel:main",
      viewIds: ["outline"],
      activeViewId: "outline",
    });
    expect(layouts.explorer.groups["explorer:tags"].viewIds).toEqual(["tags"]);
    expect(Object.values(layouts).flatMap((layout) => Object.values(layout.groups).flatMap(({ viewIds }) => viewIds)).sort())
      .toEqual(["backlinks", "outline", "project", "properties", "references", "search", "tags", "workspace"]);
  });

  it("normalizes persisted groups only when every view and tree node is valid", () => {
    const fallback = createViewGroupLayout("explorer:main", ["workspace", "outline"]);
    const valid = splitViewGroup(fallback, {
      sourceGroupId: "explorer:main",
      newGroupId: "explorer:outline",
      viewId: "outline",
      direction: "row",
      side: "after",
    });

    const normalized = normalizeViewGroupLayout(structuredClone(valid), fallback, ["workspace", "outline"]);
    expect(normalized).toEqual(valid);
    expect(normalized).not.toBe(valid);

    const duplicate = structuredClone(valid);
    duplicate.groups["explorer:outline"].viewIds = ["workspace"];
    expect(normalizeViewGroupLayout(duplicate, fallback, ["workspace", "outline"])).toEqual(fallback);

    const missingTreeGroup = structuredClone(valid);
    delete missingTreeGroup.groups["explorer:outline"];
    expect(normalizeViewGroupLayout(missingTreeGroup, fallback, ["workspace", "outline"])).toEqual(fallback);
  });

  it("docks an external view beside a target group in tree order", () => {
    const initial = createViewGroupLayout("explorer:workspace", ["workspace"]);
    const docked = dockViewBesideGroup(initial, "outline", "explorer:workspace", "explorer:outline", "column", "after");

    expect(groupIdsInViewGroupLayout(docked)).toEqual(["explorer:workspace", "explorer:outline"]);
    expect(docked.groups["explorer:outline"]).toEqual({
      id: "explorer:outline",
      viewIds: ["outline"],
      activeViewId: "outline",
    });
  });
});
