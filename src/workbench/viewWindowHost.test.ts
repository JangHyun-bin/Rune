import { describe, expect, it, vi } from "vitest";
import type { DockPayload, DockSurface, DockWorkspaceSnapshot, DockZone } from "./dockTypes";
import { DEFAULT_WORKBENCH_LAYOUT, moveViewToWorkbenchGroup } from "./workbenchLayout";
import { createViewWindowHost, type ViewWindowAdapter, type ViewWindowHandle, type ViewWindowHostOptions } from "./viewWindowHost";
import type { ViewWindowLayoutSnapshot } from "./viewWindowLayout";
import { DOCK_PROTOCOL_EVENT, type DockProtocolMessage } from "./viewWindowTransfer";

function pointerHostOptions(overrides: Partial<ViewWindowHostOptions> = {}) {
  let current: DockWorkspaceSnapshot = {
    revision: 3,
    workbench: moveViewToWorkbenchGroup(
      DEFAULT_WORKBENCH_LAYOUT,
      "outline",
      "explorer",
      "explorer:workspace",
    ),
    viewWindows: { version: 2, sessionState: "running", windows: [] },
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

function dockSurface(windowLabel: string, revision: number, zone: DockZone): DockSurface {
  return {
    windowLabel,
    revision,
    metrics: {
      windowLabel,
      windowInnerOrigin: { x: 0, y: 0 },
      webviewOffset: { x: 0, y: 0 },
      innerOrigin: { x: 0, y: 0 },
      scaleFactor: 1,
    },
    viewport: { left: 0, top: 0, width: 800, height: 800 },
    zones: [zone],
  };
}

async function crossWindowHarness(targetAck: boolean | null, multiViewSource = false) {
  let current: DockWorkspaceSnapshot = {
    revision: 10,
    workbench: multiViewSource
      ? moveViewToWorkbenchGroup(DEFAULT_WORKBENCH_LAYOUT, "tags", "explorer", "explorer:outline")
      : structuredClone(DEFAULT_WORKBENCH_LAYOUT),
    viewWindows: { version: 2, sessionState: "running", windows: [] },
    windowLabels: [],
  };
  let cursor = { x: 120, y: 120 };
  let mainSurface: DockSurface | null = null;
  let detachedSurface: DockSurface | null = null;
  let failCommitTransport = false;
  const listeners = new Map<string, (payload: unknown) => void>();
  const handles = new Map<string, ViewWindowHandle & { close: ReturnType<typeof vi.fn>; startDragging: ReturnType<typeof vi.fn> }>();
  const geometryListeners = new Map<string, () => void>();
  const captureX = new Map<string, number>();
  const emitted: Array<{ target: string; event: string; payload: unknown }> = [];
  const pendingCommits = new Map<string, Extract<DockProtocolMessage, { type: "dock:commit" }>>();
  const adapter: ViewWindowAdapter = {
    async create(label) {
      const handle = {
        label,
        close: vi.fn(async () => {}),
        focus: async () => {},
        startDragging: vi.fn(async () => {}),
        onClosed: () => () => {},
        capture: async () => ({
          bounds: { x: captureX.get(label) ?? (label === "view-1" ? 20 : 480), y: 40, width: 420, height: 640 },
          monitor: { name: "main", scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
        }),
        onGeometryChanged: async (listener: () => void) => {
          geometryListeners.set(label, listener);
          return () => { geometryListeners.delete(label); };
        },
      };
      handles.set(label, handle);
      return handle;
    },
    cursor: async () => ({ ...cursor }),
    async emitTo(target, event, payload) {
      emitted.push({ target, event, payload: structuredClone(payload) });
      if (event === DOCK_PROTOCOL_EVENT && payload && typeof payload === "object") {
        const message = payload as DockProtocolMessage;
        if (message.type === "dock:start" && target === "view-2" && detachedSurface) {
          listeners.get(DOCK_PROTOCOL_EVENT)?.({
            type: "dock:surface",
            version: 2,
            sessionId: message.sessionId,
            sourceWindowLabel: "view-2",
            surface: detachedSurface,
          } satisfies DockProtocolMessage);
        } else if (message.type === "dock:commit") {
          if (failCommitTransport) throw new Error("transport failed");
          pendingCommits.set(target, message);
        }
      }
      if (event === "rune:view-window-init" && pendingCommits.has(target) && targetAck !== null) {
        const commit = pendingCommits.get(target)!;
        pendingCommits.delete(target);
        queueMicrotask(() => listeners.get(DOCK_PROTOCOL_EVENT)?.({
          type: "dock:result",
          version: 2,
          sessionId: commit.sessionId,
          sourceWindowLabel: target,
          ok: targetAck,
          revision: current.revision,
          error: targetAck ? null : "render rejected",
        } satisfies DockProtocolMessage));
      }
    },
    async listen(event, listener) { listeners.set(event, listener); return () => {}; },
  };
  let host!: ReturnType<typeof createViewWindowHost>;
  const options: ViewWindowHostOptions = {
    adapter,
    sourceWindowLabel: "main",
    snapshot: () => current.workbench,
    dockSnapshot: () => ({
      ...structuredClone(current),
      viewWindows: host ? structuredClone(host.layoutSnapshot()) : structuredClone(current.viewWindows),
      windowLabels: host ? host.detachedWindows() : [...(current.windowLabels ?? [])],
    }),
    commitDockSnapshot: (snapshot) => { current = structuredClone(snapshot); },
    dockSurfaces: async () => mainSurface ? [structuredClone(mainSurface)] : [],
    setViewGroupDetached: vi.fn(),
    presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
    context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
    onAction: async () => undefined,
    dockAckTimeoutMs: 5,
    nativeDragIdleMs: 1,
    nativeDragStartTimeoutMs: 2,
  };
  host = createViewWindowHost(options);
  await host.start();
  await host.tearOff("explorer", "explorer:outline");
  await host.tearOff("auxiliary", "auxiliary:backlinks");
  return {
    host,
    handles,
    emitted,
    listener: listeners.get(DOCK_PROTOCOL_EVENT)!,
    current: () => structuredClone(current),
    snapshot: () => options.dockSnapshot!(),
    setCursor: (point: { x: number; y: number }) => { cursor = point; },
    setMainSurface: (surface: DockSurface | null) => { mainSurface = surface; },
    setDetachedSurface: (surface: DockSurface | null) => { detachedSurface = surface; },
    failCommitTransport: () => { failCommitTransport = true; },
    moveWindow: (label: string, x: number) => {
      captureX.set(label, x);
      geometryListeners.get(label)?.();
    },
  };
}

describe("native view window host", () => {
  it("creates, commits, initializes, and starts native movement for one dragged View in order", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const lifecycle: string[] = [];
    const startDragging = vi.fn(async () => { lifecycle.push("drag"); });
    const setBounds = vi.fn(async () => { lifecycle.push("clamp"); });
    const close = vi.fn(async () => { lifecycle.push("close"); });
    const create = vi.fn(async (): Promise<ViewWindowHandle> => {
      lifecycle.push("create");
      return {
        label: "view-1",
        close,
        focus: async () => {},
        startDragging,
        setBounds,
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

    expect(lifecycle).toEqual(["create", "apply", "hide", "init", "rune:view-window-context", "drag", "clamp"]);
    expect(create).toHaveBeenCalledWith("view-1", expect.objectContaining({
      bounds: { x: -420, y: 0, width: 420, height: 640 },
    }));
    expect(harness.current()).toMatchObject({ revision: 4, windowLabels: ["view-1"] });
    expect(harness.current().viewWindows.windows).toHaveLength(1);
    const detached = harness.current().viewWindows.windows[0];
    const detachedGroup = detached.groups[0];
    expect(harness.current().workbench.viewGroups[detachedGroup.containerId].groups[detachedGroup.groupId]).toMatchObject({
      viewIds: ["outline"],
      activeViewId: "outline",
    });
    expect(setDetached).toHaveBeenCalledWith("explorer", detachedGroup.groupId, true);
    expect(startDragging).toHaveBeenCalledTimes(1);
    expect(setBounds).toHaveBeenCalledWith({ x: -420, y: 0, width: 420, height: 640 });
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
      groups: [{ containerId: "explorer", groupId: "explorer:workspace" }],
      activeGroupId: "explorer:workspace",
      activeViewId: "outline",
    });
    expect(transfers).toEqual([expect.objectContaining({
      transfer: expect.objectContaining({
        groups: [expect.objectContaining({ group: expect.objectContaining({ viewIds: ["workspace", "outline"] }) })],
      }),
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

  it("applies a detached-to-main DockPlan exactly once before closing the empty source window", async () => {
    const harness = await crossWindowHarness(true);
    const zone: DockZone = {
      id: "container:panel",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "container", windowLabel: "main", containerId: "panel", index: 0 },
      priority: 1,
    };
    harness.setMainSurface(dockSurface("main", 10, zone));

    const start = {
      type: "dock:start",
      version: 2,
      sessionId: "view-1:main-panel",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage;
    harness.listener(start);
    harness.listener(structuredClone(start));

    await vi.waitFor(() => expect(harness.handles.get("view-1")!.close).toHaveBeenCalledTimes(1));
    expect(harness.current()).toMatchObject({ revision: 11, windowLabels: ["view-2"] });
    expect(harness.current().workbench.views.outline.containerId).toBe("panel");
    expect(harness.host.detachedWindows()).toEqual(["view-2"]);
    expect(harness.handles.get("view-1")!.startDragging).toHaveBeenCalledTimes(1);
    expect(harness.emitted.filter(({ event, payload }) => event === DOCK_PROTOCOL_EVENT
      && (payload as DockProtocolMessage).type === "dock:result")).toHaveLength(1);
  });

  it("does not persist source-window geometry while a native dock transaction is active", async () => {
    const harness = await crossWindowHarness(true);
    harness.setMainSurface(dockSurface("main", 10, {
      id: "container:panel",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "container", windowLabel: "main", containerId: "panel", index: 0 },
      priority: 1,
    }));
    let releaseDrag!: () => void;
    harness.handles.get("view-1")!.startDragging.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseDrag = resolve;
    }));
    const before = harness.host.layoutSnapshot();

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:geometry-isolation",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    });
    await vi.waitFor(() => expect(harness.handles.get("view-1")!.startDragging).toHaveBeenCalledTimes(1));
    harness.moveWindow("view-1", 900);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.host.layoutSnapshot()).toEqual(before);
    releaseDrag();
    await vi.waitFor(() => expect(harness.handles.get("view-1")!.close).toHaveBeenCalledTimes(1));
  });

  it("moves only one detached tab and preserves the remaining source group projection", async () => {
    const harness = await crossWindowHarness(true, true);
    harness.setMainSurface(dockSurface("main", 10, {
      id: "container:panel",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "container", windowLabel: "main", containerId: "panel", index: 0 },
      priority: 1,
    }));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:single-tab",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.current().revision).toBe(11));
    expect(harness.handles.get("view-1")!.close).not.toHaveBeenCalled();
    expect(harness.host.detachedWindows()).toEqual(["view-1", "view-2"]);
    expect(harness.current().workbench.viewGroups.explorer.groups["explorer:outline"].viewIds).toEqual(["tags"]);
    expect(harness.current().workbench.views.outline.containerId).toBe("panel");
  });

  it.each([false, null] as const)("rolls back a detached-to-detached transaction when render acknowledgement is %s", async (ack) => {
    const harness = await crossWindowHarness(ack);
    const before = harness.snapshot();
    const zone: DockZone = {
      id: "group:auxiliary:auxiliary:backlinks:center",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
      priority: 10,
    };
    harness.setDetachedSurface(dockSurface("view-2", 10, zone));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: `view-1:rollback-${String(ack)}`,
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.emitted.some(({ event, payload }) => event === DOCK_PROTOCOL_EVENT
      && (payload as DockProtocolMessage).type === "dock:result"
      && !(payload as Extract<DockProtocolMessage, { type: "dock:result" }>).ok)).toBe(true));
    expect(harness.snapshot()).toEqual(before);
    expect(harness.host.detachedWindows()).toEqual(["view-1", "view-2"]);
    expect(harness.handles.get("view-1")!.close).not.toHaveBeenCalled();
  });

  it("renders on only the selected detached target and closes the source after its positive acknowledgement", async () => {
    const harness = await crossWindowHarness(true);
    const zone: DockZone = {
      id: "group:auxiliary:auxiliary:backlinks:center",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
      priority: 10,
    };
    harness.setDetachedSurface(dockSurface("view-2", 10, zone));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:detached-target",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.handles.get("view-1")!.close).toHaveBeenCalledTimes(1));
    expect(harness.current().revision).toBe(11);
    expect(harness.current().workbench.viewGroups.auxiliary.groups["auxiliary:backlinks"].viewIds).toEqual([
      "backlinks",
      "outline",
    ]);
    expect(harness.host.detachedWindows()).toEqual(["view-2"]);
    const previews = harness.emitted.flatMap(({ target, event, payload }) => {
      const message = payload as DockProtocolMessage;
      return event === DOCK_PROTOCOL_EVENT && message.type === "dock:preview" && message.zone
        ? [{ target, message }]
        : [];
    });
    expect(previews.length).toBeGreaterThan(0);
    expect(new Set(previews.map(({ target }) => target))).toEqual(new Set(["view-2"]));
  });

  it("ignores stale detached surfaces and cancels without mutating the serialized layout", async () => {
    const harness = await crossWindowHarness(true);
    const before = harness.snapshot();
    harness.setDetachedSurface(dockSurface("view-2", 9, {
      id: "group:auxiliary:auxiliary:backlinks:center",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
      priority: 10,
    }));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:stale-surface",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.emitted.some(({ event, payload }) => event === DOCK_PROTOCOL_EVENT
      && (payload as DockProtocolMessage).type === "dock:cancel"
      && (payload as Extract<DockProtocolMessage, { type: "dock:cancel" }>).reason === "invalid-drop")).toBe(true));
    expect(harness.snapshot()).toEqual(before);
    expect(harness.host.detachedWindows()).toEqual(["view-1", "view-2"]);
    expect(harness.handles.get("view-1")!.close).not.toHaveBeenCalled();
  });

  it("keeps the source registered and rolls back when closing the emptied native window fails", async () => {
    const harness = await crossWindowHarness(true);
    const before = harness.snapshot();
    harness.handles.get("view-1")!.close.mockRejectedValueOnce(new Error("close failed"));
    harness.setMainSurface(dockSurface("main", 10, {
      id: "container:panel",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "container", windowLabel: "main", containerId: "panel", index: 0 },
      priority: 1,
    }));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:close-failure",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.emitted.some(({ event, payload }) => event === DOCK_PROTOCOL_EVENT
      && (payload as DockProtocolMessage).type === "dock:result"
      && !(payload as Extract<DockProtocolMessage, { type: "dock:result" }>).ok)).toBe(true));
    expect(harness.snapshot()).toEqual(before);
    expect(harness.host.detachedWindows()).toEqual(["view-1", "view-2"]);
  });

  it("restores the source without revision advance when commit transport fails", async () => {
    const harness = await crossWindowHarness(true);
    const before = harness.snapshot();
    harness.failCommitTransport();
    harness.setDetachedSurface(dockSurface("view-2", 10, {
      id: "group:auxiliary:auxiliary:backlinks:center",
      rect: { left: 0, top: 0, width: 400, height: 400 },
      target: { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
      priority: 10,
    }));

    harness.listener({
      type: "dock:start",
      version: 2,
      sessionId: "view-1:transport-failure",
      sourceWindowLabel: "view-1",
      payload: {
        kind: "view",
        viewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
      point: { x: 120, y: 120 },
    } satisfies DockProtocolMessage);

    await vi.waitFor(() => expect(harness.emitted.some(({ event, payload }) => event === DOCK_PROTOCOL_EVENT
      && (payload as DockProtocolMessage).type === "dock:result"
      && !(payload as Extract<DockProtocolMessage, { type: "dock:result" }>).ok)).toBe(true));
    expect(harness.snapshot()).toEqual(before);
    expect(harness.host.detachedWindows()).toEqual(["view-1", "view-2"]);
    expect(harness.handles.get("view-1")!.close).not.toHaveBeenCalled();
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
    const listeners = new Map<string, (payload: unknown) => void>();
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
      version: 2,
      sessionState: "running",
      windows: [{
        label: "view-1",
        groups: [
          { containerId: "explorer", groupId: "explorer:workspace" },
          { containerId: "explorer", groupId: "explorer:outline" },
        ],
        root: {
          type: "split",
          direction: "column",
          children: [
            { type: "group", groupId: "explorer:workspace" },
            { type: "group", groupId: "explorer:outline" },
          ],
          ratios: [0.35, 0.65],
        },
        activeGroupId: "explorer:outline",
        activeViewId: "outline",
        bounds: { x: 2200, y: 120, width: 900, height: 700 },
        monitor: { name: "Missing", scaleFactor: 1.5, x: 1920, y: 0, width: 2560, height: 1440 },
      }],
    };
    const onLayoutChange = vi.fn();
    const setViewGroupDetached = vi.fn();
    const emitted: unknown[] = [];
    const host = createViewWindowHost({
      adapter: {
        create,
        emitTo: async (_target, event, payload) => { if (event === "rune:view-window-init") emitted.push(payload); },
        listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
        screen: async () => ({
          primaryName: "Primary",
          monitors: [{ name: "Primary", scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
        }),
      },
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached,
      presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction: async () => undefined,
      onLayoutChange,
    });

    await host.start();
    const restoring = host.restoreLayout(layout);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(setViewGroupDetached).not.toHaveBeenCalled();
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-1" });
    await restoring;
    expect(create).toHaveBeenCalledWith("view-1", expect.objectContaining({
      bounds: { x: 187, y: 80, width: 600, height: 467 },
    }));
    expect(host.layoutSnapshot().windows[0].bounds).toEqual({ x: 20, y: 30, width: 500, height: 600 });
    expect(setViewGroupDetached).toHaveBeenCalledWith("explorer", "explorer:workspace", true);
    expect(setViewGroupDetached).toHaveBeenCalledWith("explorer", "explorer:outline", true);
    expect(emitted).toEqual([expect.objectContaining({
      transfer: expect.objectContaining({
        version: 2,
        activeGroupId: "explorer:outline",
        groups: [expect.any(Object), expect.any(Object)],
      }),
    })]);
    expect(emitted[0]).not.toHaveProperty("context");
    await host.prepareForShutdown();
    expect(host.layoutSnapshot()).toMatchObject({
      sessionState: "clean",
      windows: [{ label: "view-1", activeGroupId: "explorer:outline", activeViewId: "outline" }],
    });
    expect(onLayoutChange).toHaveBeenCalled();
  });

  it("returns only a failed restored window to main and continues restoring later windows", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const create = vi.fn(async (label: string): Promise<ViewWindowHandle> => {
      if (label === "view-1") throw new Error("first window failed");
      return { label, close: async () => {}, focus: async () => {}, onClosed: () => () => {} };
    });
    const setViewGroupDetached = vi.fn();
    const host = createViewWindowHost({
      adapter: {
        create,
        emitTo: async () => {},
        listen: async (event, listener) => { listeners.set(event, listener); return () => {}; },
      },
      sourceWindowLabel: "main",
      snapshot: () => DEFAULT_WORKBENCH_LAYOUT,
      setViewGroupDetached,
      presentation: () => ({ theme: "dark", uiScale: 1, locale: "en" }),
      context: () => ({ currentFolder: null, activePath: null, activeMarkdown: null, activeLine: 1, workspaceTree: [], workspaceFiles: [], backlinks: "noDocument", references: "noProject" }),
      onAction: async () => undefined,
      readyTimeoutMs: 50,
    });
    await host.start();
    const placement = {
      bounds: { x: 10, y: 10, width: 420, height: 640 },
      monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 1920, height: 1080 },
    };
    const restoring = host.restoreLayout({
      version: 2,
      sessionState: "clean",
      windows: [
        {
          label: "view-1",
          groups: [{ containerId: "explorer", groupId: "explorer:outline" }],
          root: { type: "group", groupId: "explorer:outline" },
          activeGroupId: "explorer:outline",
          activeViewId: "outline",
          ...placement,
        },
        {
          label: "view-2",
          groups: [{ containerId: "auxiliary", groupId: "auxiliary:backlinks" }],
          root: { type: "group", groupId: "auxiliary:backlinks" },
          activeGroupId: "auxiliary:backlinks",
          activeViewId: "backlinks",
          ...placement,
        },
      ],
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith("view-2", expect.any(Object)));
    listeners.get("rune:view-window-ready")?.({ windowLabel: "view-2" });
    await restoring;

    expect(host.detachedWindows()).toEqual(["view-2"]);
    expect(setViewGroupDetached).not.toHaveBeenCalledWith("explorer", "explorer:outline", true);
    expect(setViewGroupDetached).toHaveBeenCalledWith("auxiliary", "auxiliary:backlinks", true);
  });
});
