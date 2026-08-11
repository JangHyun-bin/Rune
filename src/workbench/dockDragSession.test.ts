import { describe, expect, it } from "vitest";
import type { DockPayload, DockSurface, DockWorkspaceSnapshot } from "./dockTypes";
import { createDockDragCoordinator, type DockDragPreview } from "./dockDragSession";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";

const payload: DockPayload = {
  kind: "view",
  viewId: "outline",
  source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:outline" },
};

function workspace(): DockWorkspaceSnapshot {
  return {
    revision: 3,
    workbench: structuredClone(DEFAULT_WORKBENCH_LAYOUT),
    viewWindows: { version: 2, sessionState: "running", windows: [] },
  };
}

function surface(revision = 3): DockSurface {
  return {
    windowLabel: "main",
    revision,
    metrics: {
      windowLabel: "main",
      windowInnerOrigin: { x: 0, y: 0 },
      webviewOffset: { x: 0, y: 0 },
      innerOrigin: { x: 0, y: 0 },
      scaleFactor: 1,
    },
    viewport: { left: 0, top: 0, width: 500, height: 400 },
    zones: [{
      id: "workspace-center",
      rect: { left: 0, top: 0, width: 100, height: 100 },
      target: { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
      priority: 10,
    }],
  };
}

function setup() {
  let current = workspace();
  const previews: Array<DockDragPreview | null> = [];
  const commits: DockWorkspaceSnapshot[] = [];
  const newWindows: Array<{ payload: DockPayload; point: { x: number; y: number } }> = [];
  const coordinator = createDockDragCoordinator({
    threshold: 5,
    snapshot: () => current,
    surfaces: () => [surface(current.revision)],
    preview: (value) => { previews.push(value); },
    commit: async ({ snapshot }) => {
      commits.push(snapshot);
      current = snapshot;
    },
    requestNewWindow: async (nextPayload, point) => {
      newWindows.push({ payload: nextPayload, point });
    },
  });
  return { coordinator, current: () => current, previews, commits, newWindows };
}

describe("dock drag coordinator", () => {
  it("arms on pointerdown without moving the View", () => {
    const { coordinator, current, commits } = setup();
    const before = structuredClone(current());

    expect(coordinator.begin({ pointerId: 1, payload, client: { x: 20, y: 20 } })).toBe(true);

    expect(coordinator.state()).toBe("armed");
    expect(commits).toEqual([]);
    expect(current()).toEqual(before);
  });

  it("ends an armed session on pointer release so clicks stay clicks", async () => {
    const { coordinator, current, commits } = setup();
    const before = structuredClone(current());
    coordinator.begin({ pointerId: 1, payload, client: { x: 20, y: 20 } });

    await expect(coordinator.drop({ pointerId: 1, screen: { x: 20, y: 20 } })).resolves.toBe("cancelled");

    expect(coordinator.state()).toBe("idle");
    expect(commits).toEqual([]);
    expect(current()).toEqual(before);
  });

  it("crosses the CSS-pixel threshold exactly once", () => {
    const { coordinator, previews } = setup();
    coordinator.begin({ pointerId: 1, payload, client: { x: 10, y: 10 } });

    coordinator.move({ pointerId: 1, client: { x: 13, y: 13 }, screen: { x: 13, y: 13 } });
    expect(coordinator.state()).toBe("armed");
    expect(previews).toEqual([]);

    coordinator.move({ pointerId: 1, client: { x: 16, y: 10 }, screen: { x: 16, y: 10 } });
    coordinator.move({ pointerId: 1, client: { x: 20, y: 10 }, screen: { x: 20, y: 10 } });
    expect(coordinator.state()).toBe("dragging");
    expect(previews).toHaveLength(2);
  });

  it("changes hover preview without changing the snapshot revision", () => {
    const { coordinator, current, previews } = setup();
    coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } });
    const revision = current().revision;

    coordinator.move({ pointerId: 1, client: { x: 10, y: 0 }, screen: { x: 10, y: 10 } });
    coordinator.move({ pointerId: 1, client: { x: 150, y: 0 }, screen: { x: 150, y: 10 } });

    expect(previews[0]?.zone?.id).toBe("workspace-center");
    expect(previews[1]?.zone).toBeNull();
    expect(current().revision).toBe(revision);
  });

  it("cancels on Escape and clears the preview", () => {
    const { coordinator, previews, commits } = setup();
    coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } });
    coordinator.move({ pointerId: 1, client: { x: 10, y: 0 }, screen: { x: 10, y: 10 } });

    expect(coordinator.cancel()).toBe(true);

    expect(coordinator.state()).toBe("cancelled");
    expect(previews.at(-1)).toBeNull();
    expect(commits).toEqual([]);
  });

  it("commits one atomic plan on a valid pointer release", async () => {
    const { coordinator, current, commits } = setup();
    coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } });
    coordinator.move({ pointerId: 1, client: { x: 10, y: 0 }, screen: { x: 10, y: 10 } });

    const first = coordinator.drop({ pointerId: 1, screen: { x: 10, y: 10 } });
    const second = coordinator.drop({ pointerId: 1, screen: { x: 10, y: 10 } });
    await Promise.all([first, second]);

    expect(commits).toHaveLength(1);
    expect(current().revision).toBe(4);
    expect(current().workbench.viewGroups.explorer.groups["explorer:workspace"].viewIds).toEqual(["workspace", "outline"]);
    expect(coordinator.state()).toBe("idle");
  });

  it("requests a new window only outside every Rune viewport", async () => {
    const inside = setup();
    inside.coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } });
    inside.coordinator.move({ pointerId: 1, client: { x: 250, y: 0 }, screen: { x: 250, y: 200 } });
    await inside.coordinator.drop({ pointerId: 1, screen: { x: 250, y: 200 } });
    expect(inside.newWindows).toEqual([]);
    expect(inside.coordinator.state()).toBe("cancelled");

    const outside = setup();
    outside.coordinator.begin({ pointerId: 2, payload, client: { x: 0, y: 0 } });
    outside.coordinator.move({ pointerId: 2, client: { x: 600, y: 0 }, screen: { x: 600, y: 200 } });
    await outside.coordinator.drop({ pointerId: 2, screen: { x: 600, y: 200 } });
    expect(outside.newWindows).toEqual([{ payload, point: { x: 600, y: 200 } }]);
    expect(outside.coordinator.state()).toBe("idle");
  });

  it("does not let a second pointer join an active session", () => {
    const { coordinator } = setup();

    expect(coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } })).toBe(true);
    expect(coordinator.begin({ pointerId: 2, payload, client: { x: 0, y: 0 } })).toBe(false);
    expect(coordinator.move({ pointerId: 2, client: { x: 10, y: 0 }, screen: { x: 10, y: 10 } })).toBeNull();
    expect(coordinator.state()).toBe("armed");
  });

  it("cancels without mutation when the source snapshot is lost", async () => {
    const { coordinator, current, commits } = setup();
    coordinator.begin({ pointerId: 1, payload, client: { x: 0, y: 0 } });
    coordinator.move({ pointerId: 1, client: { x: 10, y: 0 }, screen: { x: 10, y: 10 } });
    current().revision += 1;

    await expect(coordinator.drop({ pointerId: 1, screen: { x: 10, y: 10 } })).resolves.toBe("cancelled");

    expect(commits).toEqual([]);
    expect(coordinator.state()).toBe("cancelled");
  });
});
