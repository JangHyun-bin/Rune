import { describe, expect, it, vi } from "vitest";
import type { DockPayload, DockWorkspaceSnapshot } from "./dockTypes";
import { DEFAULT_WORKBENCH_LAYOUT, moveViewToWorkbenchGroup } from "./workbenchLayout";
import { createViewWindowHost, type ViewWindowAdapter, type ViewWindowHandle, type ViewWindowHostOptions } from "./viewWindowHost";
import type { ViewWindowLayoutSnapshot } from "./viewWindowLayout";

function pointerHostOptions(overrides: Partial<ViewWindowHostOptions> = {}) {
  let current: DockWorkspaceSnapshot = {
    revision: 3,
    workbench: moveViewToWorkbenchGroup(
      DEFAULT_WORKBENCH_LAYOUT,
      "outline",
      "explorer",
      "explorer:workspace",
    ),
    viewWindows: { version: 1, sessionState: "running", windows: [] },
    windowLabels: [],
  };
  const committed: DockWorkspaceSnapshot[] = [];
  const options: ViewWindowHostOptions = {
    sourceWindowLabel: "main",
    snapshot: () => current.workbench,
    dockSnapshot: () => structuredClone(current),
    commitDockSnapshot: (snapshot) => {
      current = structuredClone(snapshot);
      committed.push(structuredClone(snapshot));
    },
    setViewGroupDetached: vi.fn(),
    presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
    context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
    onAction: async () => undefined,
    readyTimeoutMs: 25,
    adapter: {
      create: async () => { throw new Error("adapter required"); },
      emitTo: async () => {},
      listen: async () => () => {},
    },
    ...overrides,
  };
  return {
    current: () => current,
    committed,
    options,
  };
}

describe("native view window host", () => {
  it("creates, commits, initializes, and starts native movement for one dragged View in order", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const lifecycle: string[] = [];
    const startDragging = vi.fn(async () => { lifecycle.push("drag"); });
    const close = vi.fn(async () => { lifecycle.push("close"); });
    const create = vi.fn(async (): Promise<ViewWindowHandle> => {
      lifecycle.push("create");
      return {
        label: "view-1",
        close,
        focus: async () => {},
        startDragging,
        onClosed: () => () => {},
      };
    });
    const adapter: ViewWindowAdapter = {
      create,
      emitTo: vi.fn(async (_target, event) => { lifecycle.push(event === "rune:view-window-init" ? "init" : event); }),
      listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      screen: async () => ({
        primaryName: "left",
        monitors: [{ name: "left", scaleFactor: 1.25, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }],
      }),
    };
    const harness = pointerHostOptions({ adapter });
    const baseCommit = harness.options.commitDockSnapshot;
    harness.options.commitDockSnapshot = (snapshot: DockWorkspaceSnapshot) => {
      lifecycle.push("apply");
      baseCommit(snapshot);
    };
    const setDetached = harness.options.setViewGroupDetached as ReturnType<typeof vi.fn>;
    setDetached.mockImplementation(() => { lifecycle.push("hide"); });
    const host = createViewWindowHost(harness.options);
    await host.start();
    const payload: DockPayload = {
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    };

    const tearingOff = host.tearOffPayload(payload, { x: -100, y: 50 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    await expect(tearingOff).resolves.toBe("view-1");

    expect(lifecycle).toEqual(["create", "apply", "hide", "init", "drag"]);
    expect(create).toHaveBeenCalledWith("view-1", expect.objectContaining({
      bounds: { x: -420, y: 0, width: 420, height: 640 },
    }));
    expect(harness.current()).toMatchObject({ revision: 4, windowLabels: ["view-1"] });
    expect(harness.current().viewWindows.windows).toHaveLength(1);
    const detached = harness.current().viewWindows.windows[0];
    expect(harness.current().workbench.viewGroups.explorer.groups[detached.groupId]).toMatchObject({
      viewIds: ["outline"],
      activeViewId: "outline",
    });
    expect(setDetached).toHaveBeenCalledWith("explorer", detached.groupId, true);
    expect(startDragging).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it.each(["init", "drag"] as const)("rolls back ownership and layout when native %s fails", async (failure) => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const close = vi.fn(async () => {});
    const adapter: ViewWindowAdapter = {
      create: async () => ({
        label: "view-1",
        close,
        focus: async () => {},
        startDragging: async () => { if (failure === "drag") throw new Error("drag failed"); },
        onClosed: () => () => {},
      }),
      emitTo: async (_target, event) => { if (failure === "init" && event === "rune:view-window-init") throw new Error("init failed"); },
      listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      screen: async () => ({ primaryName: "main", monitors: [{ name: "main", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }),
    };
    const harness = pointerHostOptions({ adapter });
    const before = structuredClone(harness.current());
    const host = createViewWindowHost(harness.options);
    await host.start();
    const opening = host.tearOffPayload({
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    }, { x: 900, y: 500 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });

    await expect(opening).rejects.toThrow(`${failure} failed`);
    expect(harness.current()).toEqual(before);
    expect(host.detachedWindows()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.options.setViewGroupDetached).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), false);
  });

  it("closes an unready native window without changing the source snapshot", async () => {
    const close = vi.fn(async () => {});
    const adapter: ViewWindowAdapter = {
      create: async () => ({ label: "view-1", close, focus: async () => {}, startDragging: async () => {}, onClosed: () => () => {} }),
      emitTo: async () => {},
      listen: async () => () => {},
      screen: async () => ({ primaryName: "main", monitors: [{ name: "main", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }),
    };
    const harness = pointerHostOptions({ adapter, readyTimeoutMs: 1 });
    const before = structuredClone(harness.current());
    const host = createViewWindowHost(harness.options);
    await host.start();

    await expect(host.tearOffPayload({
      kind: "group",
      viewIds: ["workspace", "outline"],
      activeViewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    }, { x: 900, y: 500 })).rejects.toThrow("ready");

    expect(harness.current()).toEqual(before);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the complete group together when the group handle requests tear-off", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const transfers: unknown[] = [];
    const adapter: ViewWindowAdapter = {
      create: async () => ({ label: "view-1", close: async () => {}, focus: async () => {}, startDragging: async () => {}, onClosed: () => () => {} }),
      emitTo: async (_target, event, value) => { if (event === "rune:view-window-init") transfers.push(value); },
      listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      screen: async () => ({ primaryName: "main", monitors: [{ name: "main", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }),
    };
    const harness = pointerHostOptions({ adapter });
    const host = createViewWindowHost(harness.options);
    await host.start();
    const opening = host.tearOffPayload({
      kind: "group",
      viewIds: ["workspace", "outline"],
      activeViewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    }, { x: 900, y: 500 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    await opening;

    expect(harness.current().workbench.viewGroups.explorer.groups["explorer:workspace"].viewIds).toEqual(["workspace", "outline"]);
    expect(harness.current().viewWindows.windows[0]).toMatchObject({
      groupId: "explorer:workspace",
      activeViewId: "outline",
    });
    expect(transfers).toEqual([expect.objectContaining({
      transfer: expect.objectContaining({ group: expect.objectContaining({ viewIds: ["workspace", "outline"] }) }),
    })]);
  });

  it("preserves the source when native creation or DockPlan validation fails", async () => {
    const createHarness = pointerHostOptions({
      adapter: {
        create: async () => { throw new Error("create failed"); },
        emitTo: async () => {},
        listen: async () => () => {},
      },
    });
    const createBefore = structuredClone(createHarness.current());
    const createHost = createViewWindowHost(createHarness.options);
    await createHost.start();
    await expect(createHost.tearOffPayload({
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    }, { x: 100, y: 100 })).rejects.toThrow("create failed");
    expect(createHarness.current()).toEqual(createBefore);

    const listeners = new Map<string, (payload: unknown) => void>();
    const close = vi.fn(async () => {});
    const planHarness = pointerHostOptions({
      adapter: {
        create: async () => ({ label: "view-1", close, focus: async () => {}, startDragging: async () => {}, onClosed: () => () => {} }),
        emitTo: async () => {},
        listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      },
    });
    const planBefore = structuredClone(planHarness.current());
    const planHost = createViewWindowHost(planHarness.options);
    await planHost.start();
    const rejected = planHost.tearOffPayload({
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:missing" },
    }, { x: 100, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    await expect(rejected).rejects.toThrow("invalid-source");

    expect(planHarness.current()).toEqual(planBefore);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the incomplete window without overwriting a source change made while waiting for readiness", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const close = vi.fn(async () => {});
    const harness = pointerHostOptions({
      adapter: {
        create: async () => ({ label: "view-1", close, focus: async () => {}, startDragging: async () => {}, onClosed: () => () => {} }),
        emitTo: async () => {},
        listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      },
    });
    const host = createViewWindowHost(harness.options);
    await host.start();
    const opening = host.tearOffPayload({
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "main", containerId: "explorer", groupId: "explorer:workspace" },
    }, { x: 100, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const changed = structuredClone(harness.current());
    changed.revision += 1;
    changed.workbench = { ...changed.workbench, panelVisible: !changed.workbench.panelVisible };
    harness.options.commitDockSnapshot?.(changed);
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });

    await expect(opening).rejects.toThrow("Dock source changed");
    expect(harness.current()).toEqual(changed);
    expect(host.detachedWindows()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("hides a group only after window creation and restores it on re-dock", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const closeListeners: Array<() => void> = [];
    const handle: ViewWindowHandle = {
      label: "view-1",
      close: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      onClosed(listener) { closeListeners.push(listener); return () => {}; },
    };
    const adapter: ViewWindowAdapter = {
      create: vi.fn(async () => handle),
      emitTo: vi.fn(async () => {}),
      listen: vi.fn(async (event, listener) => { listeners.set(event, listener); return () => {}; }),
    };
    const setViewGroupDetached = vi.fn();
    const onAction = vi.fn(async () => "done");
    const host = createViewWindowHost({
      adapter,
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached,
      presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction,
    });
    await host.start();

    const label = await host.tearOff("explorer", "explorer:outline");
    expect(label).toBe("view-1");
    expect(setViewGroupDetached).toHaveBeenCalledWith("explorer", "explorer:outline", true);

    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    expect(adapter.emitTo).toHaveBeenCalledWith("view-1", "rune:view-window-init", expect.objectContaining({
      transfer: expect.objectContaining({ targetWindowLabel: "view-1" }),
    }));

    await host.broadcastContext();
    expect(adapter.emitTo).toHaveBeenCalledWith("view-1", "rune:view-window-context", expect.objectContaining({ activeLine: 1 }));
    listeners.get("rune:view-window-action")?.({ windowLabel: "unknown", type: "open-folder" });
    listeners.get("rune:view-window-action")?.({ windowLabel: "view-1", requestId: "request-1", type: "open-folder" });
    await Promise.resolve();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(adapter.emitTo).toHaveBeenCalledWith("view-1", "rune:view-window-action-result", {
      requestId: "request-1", ok: true, value: "done",
    });
    expect(host.has("view-1")).toBe(true);
    expect(host.has("unknown")).toBe(false);
    expect(host.detachedWindows()).toEqual(["view-1"]);

    listeners.get("rune:view-window-redock")?.({ windowLabel: "view-1" });
    await Promise.resolve();
    expect(setViewGroupDetached).toHaveBeenLastCalledWith("explorer", "explorer:outline", false);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("restores ownership when a detached window closes unexpectedly", async () => {
    let onClosed: (() => void) | undefined;
    const adapter: ViewWindowAdapter = {
      create: async () => ({
        label: "view-1",
        close: async () => {},
        focus: async () => {},
        onClosed(listener) { onClosed = listener; return () => {}; },
      }),
      emitTo: async () => {},
      listen: async () => () => {},
    };
    const setViewGroupDetached = vi.fn();
    const host = createViewWindowHost({
      adapter,
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached,
      presentation: () => ({ theme: "light", uiScale: 1, locale: "ko" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction: async () => undefined,
    });
    await host.start();
    await host.tearOff("explorer", "explorer:outline");

    onClosed?.();
    expect(setViewGroupDetached).toHaveBeenLastCalledWith("explorer", "explorer:outline", false);
  });

  it("does not lose a ready event that arrives while the native window is being created", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    let finishCreate!: (handle: ViewWindowHandle) => void;
    const adapter: ViewWindowAdapter = {
      create: () => new Promise((resolve) => { finishCreate = resolve; }),
      emitTo: vi.fn(async () => {}),
      listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
    };
    const host = createViewWindowHost({
      adapter,
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached: () => {},
      presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction: async () => undefined,
    });
    await host.start();
    const opening = host.tearOff("explorer", "explorer:outline");
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    finishCreate({ label: "view-1", close: async () => {}, focus: async () => {}, onClosed: () => () => {} });
    await opening;

    expect(adapter.emitTo).toHaveBeenCalledWith("view-1", "rune:view-window-init", expect.any(Object));
  });

  it("restores recovered bounds and keeps the window snapshot on clean shutdown", async () => {
    const create = vi.fn(async (label: string): Promise<ViewWindowHandle> => ({
      label,
      close: async () => {},
      focus: async () => {},
      onClosed: () => () => {},
      capture: async () => ({
        bounds: { x: 20, y: 30, width: 500, height: 600 },
        monitor: { name: "Primary", scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1040 },
      }),
      onGeometryChanged: async () => () => {},
    }));
    const layout: ViewWindowLayoutSnapshot = {
      version: 1,
      sessionState: "running",
      windows: [{
        containerId: "explorer",
        groupId: "explorer:outline",
        activeViewId: "outline",
        bounds: { x: 2200, y: 120, width: 900, height: 700 },
        monitor: { name: "Missing", scaleFactor: 1.5, x: 1920, y: 0, width: 2560, height: 1440 },
      }],
    };
    const onLayoutChange = vi.fn();
    const host = createViewWindowHost({
      adapter: {
        create,
        emitTo: async () => {},
        listen: async () => () => {},
        screen: async () => ({
          primaryName: "Primary",
          monitors: [{ name: "Primary", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
        }),
      },
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached: () => {},
      presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction: async () => undefined,
      onLayoutChange,
    });

    await host.restoreLayout(layout);
    expect(create).toHaveBeenCalledWith("view-1", expect.objectContaining({
      bounds: { x: 187, y: 80, width: 600, height: 467 },
    }));
    expect(host.layoutSnapshot().windows[0].bounds).toEqual({ x: 20, y: 30, width: 500, height: 600 });
    await host.prepareForShutdown();
    expect(host.layoutSnapshot()).toMatchObject({ sessionState: "clean", windows: [{ groupId: "explorer:outline" }] });
    expect(onLayoutChange).toHaveBeenCalled();
  });
});
