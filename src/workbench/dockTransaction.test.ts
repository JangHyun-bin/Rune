import { describe, expect, it } from "vitest";
import type { DockPayload, DockTarget, DockWorkspaceSnapshot } from "./dockTypes";
import { applyDockPlan, planDock } from "./dockTransaction";
import { viewGroupIdForView } from "./viewGroupLayout";
import { DEFAULT_WORKBENCH_LAYOUT, moveViewToWorkbenchGroup } from "./workbenchLayout";

function workspace(workbench = structuredClone(DEFAULT_WORKBENCH_LAYOUT)): DockWorkspaceSnapshot {
  return {
    revision: 4,
    workbench,
    viewWindows: { version: 1, sessionState: "running", windows: [] },
  };
}

function viewPayload(viewId: "outline" | "tags", groupId: string, windowLabel = "main"): DockPayload {
  return { kind: "view", viewId, source: { windowLabel, containerId: "explorer", groupId } };
}

function commit(snapshot: DockWorkspaceSnapshot, payload: DockPayload, target: DockTarget): DockWorkspaceSnapshot {
  const plan = planDock(snapshot, payload, target);
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.reason);
  const applied = applyDockPlan(snapshot, plan);
  expect(applied.ok).toBe(true);
  if (!applied.ok) throw new Error(applied.reason);
  return applied.snapshot;
}

describe("atomic dock transactions", () => {
  it("reorders a view tab without mutating the input", () => {
    const initial = workspace(moveViewToWorkbenchGroup(
      DEFAULT_WORKBENCH_LAYOUT,
      "outline",
      "explorer",
      "explorer:workspace",
    ));
    const before = structuredClone(initial);

    const next = commit(
      initial,
      viewPayload("outline", "explorer:workspace"),
      { kind: "tabs", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", index: 0 },
    );

    expect(next.workbench.viewGroups.explorer.groups["explorer:workspace"].viewIds).toEqual(["outline", "workspace"]);
    expect(next.revision).toBe(initial.revision + 1);
    expect(initial).toEqual(before);
  });

  it("moves a view across containers and combines it at the center target", () => {
    const initial = workspace();
    const next = commit(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "main", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
    );

    expect(next.workbench.views.outline.containerId).toBe("auxiliary");
    expect(next.workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].viewIds).toEqual(["backlinks", "outline"]);
    expect(next.workbench.viewGroups.explorer.groups["explorer:outline"]).toBeUndefined();
  });

  it.each([
    ["row", "before"],
    ["row", "after"],
    ["column", "before"],
    ["column", "after"],
  ] as const)("splits a view on the %s/%s edge", (direction, side) => {
    const initial = workspace();
    const next = commit(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "split", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", direction, side },
    );
    const newGroupId = viewGroupIdForView(next.workbench.viewGroups.explorer, "outline");

    expect(newGroupId).not.toBe("explorer:outline");
    expect(newGroupId).not.toBe("explorer:workspace");
    expect(next.workbench.viewGroups.explorer.root).toMatchObject({ type: "split" });
  });

  it("moves a whole group in order and cleans up its empty source", () => {
    const grouped = moveViewToWorkbenchGroup(
      DEFAULT_WORKBENCH_LAYOUT,
      "outline",
      "explorer",
      "explorer:workspace",
    );
    const initial = workspace(grouped);
    const next = commit(
      initial,
      {
        kind: "group",
        viewIds: ["workspace", "outline"],
        activeViewId: "outline",
        source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
      },
      { kind: "combine", windowLabel: "main", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
    );

    expect(next.workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].viewIds).toEqual([
      "backlinks",
      "workspace",
      "outline",
    ]);
    expect(next.workbench.viewGroups.explorer.groups["explorer:workspace"]).toBeUndefined();
    expect(next.workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].activeViewId).toBe("outline");
  });

  it("extracts a view into a new native-window projection", () => {
    const initial = workspace();
    const next = commit(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "new-window", bounds: { x: 40, y: 60, width: 480, height: 640 } },
    );
    const detachedGroupId = viewGroupIdForView(next.workbench.viewGroups.explorer, "outline");

    expect(next.viewWindows.windows).toHaveLength(1);
    expect(next.viewWindows.windows[0]).toMatchObject({
      containerId: "explorer",
      groupId: detachedGroupId,
      activeViewId: "outline",
      bounds: { x: 40, y: 60, width: 480, height: 640 },
    });
  });

  it("closes an emptied detached source window after redocking", () => {
    const initial = workspace();
    initial.windowLabels = ["view-7"];
    initial.viewWindows.windows.push({
      containerId: "explorer",
      groupId: "explorer:outline",
      activeViewId: "outline",
      bounds: { x: 20, y: 20, width: 420, height: 600 },
      monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
    });
    const plan = planDock(
      initial,
      viewPayload("outline", "explorer:outline", "view-7"),
      { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    );
    expect(plan).toMatchObject({ ok: true, effects: [{ kind: "close-window", windowLabel: "view-7" }] });
    if (!plan.ok) throw new Error(plan.reason);
    const applied = applyDockPlan(initial, plan);
    if (!applied.ok) throw new Error(applied.reason);

    expect(applied.snapshot.viewWindows.windows).toEqual([]);
    expect(applied.snapshot.windowLabels).toEqual([]);
    expect(applied.snapshot.workbench.viewGroups.explorer.groups["explorer:outline"]).toBeUndefined();
  });

  it.each([
    ["Primary Sidebar", { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" }],
    ["Secondary Sidebar empty container", { kind: "container", windowLabel: "main", containerId: "auxiliary", index: 1 }],
    ["Panel empty container", { kind: "container", windowLabel: "main", containerId: "panel", index: 1 }],
    ["exact tab index", { kind: "tabs", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", index: 0 }],
    ["left split edge", { kind: "split", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", direction: "row", side: "before" }],
    ["right split edge", { kind: "split", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", direction: "row", side: "after" }],
    ["top split edge", { kind: "split", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", direction: "column", side: "before" }],
    ["bottom split edge", { kind: "split", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace", direction: "column", side: "after" }],
  ] as const)("docks a detached View into the main-window %s destination", (_name, target) => {
    const initial = workspace();
    initial.windowLabels = ["view-1"];
    initial.viewWindows.windows.push({
      containerId: "explorer",
      groupId: "explorer:outline",
      activeViewId: "outline",
      bounds: { x: 20, y: 20, width: 420, height: 600 },
      monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
    });

    const next = commit(initial, viewPayload("outline", "explorer:outline", "view-1"), target);

    expect(next.revision).toBe(initial.revision + 1);
    expect(next.windowLabels).toEqual([]);
    expect(next.viewWindows.windows).toEqual([]);
  });

  it("combines a detached View into another detached window and closes only the empty source", () => {
    const initial = workspace();
    initial.windowLabels = ["view-1", "view-2"];
    initial.viewWindows.windows.push(
      {
        containerId: "explorer",
        groupId: "explorer:outline",
        activeViewId: "outline",
        bounds: { x: 20, y: 20, width: 420, height: 600 },
        monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        containerId: "auxiliary",
        groupId: "auxiliary:backlinks",
        activeViewId: "backlinks",
        bounds: { x: 480, y: 20, width: 420, height: 600 },
        monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
      },
    );

    const plan = planDock(
      initial,
      viewPayload("outline", "explorer:outline", "view-1"),
      { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
    );
    expect(plan).toMatchObject({ ok: true, effects: [{ kind: "close-window", windowLabel: "view-1" }] });
    if (!plan.ok) throw new Error(plan.reason);
    const applied = applyDockPlan(initial, plan);
    if (!applied.ok) throw new Error(applied.reason);

    expect(applied.snapshot.windowLabels).toEqual(["view-2"]);
    expect(applied.snapshot.workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].viewIds).toEqual([
      "backlinks",
      "outline",
    ]);
  });

  it("keeps a detached target projection aligned with its newly active view", () => {
    const initial = workspace();
    initial.viewWindows.windows.push({
      containerId: "auxiliary",
      groupId: "auxiliary:backlinks",
      activeViewId: "backlinks",
      bounds: { x: 20, y: 20, width: 420, height: 600 },
      monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
    });

    const next = commit(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "view-1", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
    );

    expect(next.viewWindows.windows[0].activeViewId).toBe("outline");
    expect(next.workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].activeViewId).toBe("outline");
  });

  it("rejects duplicate view ownership", () => {
    const initial = workspace();
    initial.workbench.viewGroups.explorer.groups["explorer:workspace"].viewIds.push("outline");

    expect(planDock(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    )).toEqual({ ok: false, reason: "duplicate-view" });
  });

  it("rejects applying a plan against a stale revision", () => {
    const initial = workspace();
    const plan = planDock(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    );
    if (!plan.ok) throw new Error(plan.reason);

    expect(applyDockPlan({ ...initial, revision: initial.revision + 1 }, plan)).toEqual({
      ok: false,
      reason: "stale-revision",
    });
  });

  it("reports a self-drop as a no-op", () => {
    const initial = workspace();
    expect(planDock(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:outline" },
    )).toEqual({ ok: false, reason: "no-op" });
  });

  it("rejects an invalid target without changing the snapshot", () => {
    const initial = workspace();
    const before = structuredClone(initial);
    const plan = planDock(
      initial,
      viewPayload("outline", "explorer:outline"),
      { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "missing" },
    );

    expect(plan).toEqual({ ok: false, reason: "invalid-target" });
    expect(initial).toEqual(before);
  });
});
