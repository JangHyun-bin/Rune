import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";
import { createViewWindowHost, type ViewWindowAdapter, type ViewWindowHandle } from "./viewWindowHost";
import type { ViewWindowLayoutSnapshot } from "./viewWindowLayout";

describe("native view window host", () => {
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
