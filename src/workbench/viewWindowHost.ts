import type { FileNode } from "../ipc/bindings";
import type { BacklinksPanelState } from "../workspace/backlinksPanel";
import type { ReferencesPanelState } from "../workspace/referencesPanel";
import type { WorkbenchContainerId, WorkbenchLayoutSnapshot, WorkbenchViewId } from "./workbenchLayout";
import type { ViewWindowPresentation, ViewWindowTransfer } from "./viewWindowTransfer";
import { recoverWindowBounds, type AvailableMonitor, type PersistedViewWindow, type ViewWindowLayoutSnapshot, type WindowBounds, type WindowMonitorSnapshot } from "./viewWindowLayout";

export interface ViewWindowContext {
  currentFolder: string | null;
  activePath: string | null;
  activeMarkdown: string | null;
  activeLine: number;
  workspaceTree: FileNode[];
  workspaceFiles: Array<{ name: string; path: string }>;
  backlinks: BacklinksPanelState;
  references: ReferencesPanelState;
}

export interface ViewWindowHandle {
  label: string;
  close(): Promise<void>;
  focus(): Promise<void>;
  onClosed(listener: () => void): () => void;
  capture?(): Promise<{ bounds: WindowBounds; monitor: WindowMonitorSnapshot }>;
  onGeometryChanged?(listener: () => void): Promise<() => void>;
}

export interface ViewWindowAdapter {
  create(label: string, options: {
    url: string;
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    bounds?: WindowBounds;
  }): Promise<ViewWindowHandle>;
  emitTo(target: string, event: string, payload: unknown): Promise<void>;
  listen(event: string, listener: (payload: unknown) => void): Promise<() => void>;
  screen?(): Promise<{ monitors: AvailableMonitor[]; primaryName: string | null }>;
}

interface ViewWindowHostOptions {
  adapter: ViewWindowAdapter;
  sourceWindowLabel: string;
  snapshot(): WorkbenchLayoutSnapshot;
  setViewGroupDetached(containerId: WorkbenchContainerId, groupId: string, detached: boolean): void;
  presentation(): ViewWindowPresentation;
  context(): ViewWindowContext;
  onAction(payload: unknown): Promise<unknown>;
  onLayoutChange?(snapshot: ViewWindowLayoutSnapshot): void;
}

interface DetachedWindow {
  containerId: WorkbenchContainerId;
  groupId: string;
  handle: ViewWindowHandle;
  transfer: ViewWindowTransfer;
  persisted: PersistedViewWindow | null;
  stopGeometry?: () => void;
}

function windowLabel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const label = (payload as Record<string, unknown>).windowLabel;
  return typeof label === "string" ? label : null;
}

function requestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = (payload as Record<string, unknown>).requestId;
  return typeof id === "string" && id ? id : null;
}

export function createViewWindowHost(options: ViewWindowHostOptions) {
  const windows = new Map<string, DetachedWindow>();
  const opening = new Set<string>();
  const ready = new Set<string>();
  const unlisten: Array<() => void> = [];
  let nextWindow = 0;
  let sessionState: ViewWindowLayoutSnapshot["sessionState"] = "running";
  let shuttingDown = false;

  const layoutSnapshot = (): ViewWindowLayoutSnapshot => ({
    version: 1,
    sessionState,
    windows: [...windows.values()].flatMap((window) => window.persisted ? [window.persisted] : []),
  });
  const changed = (): void => options.onLayoutChange?.(layoutSnapshot());
  const capture = async (label: string): Promise<void> => {
    const detached = windows.get(label);
    if (!detached?.handle.capture) return;
    const placement = await detached.handle.capture();
    if (windows.get(label) !== detached) return;
    detached.persisted = {
      containerId: detached.containerId,
      groupId: detached.groupId,
      activeViewId: detached.transfer.group.activeViewId!,
      ...placement,
    };
    changed();
  };

  const restore = (label: string): DetachedWindow | null => {
    const detached = windows.get(label);
    if (!detached) return null;
    windows.delete(label);
    detached.stopGeometry?.();
    options.setViewGroupDetached(detached.containerId, detached.groupId, false);
    if (!shuttingDown) changed();
    return detached;
  };

  const redock = async (label: string): Promise<void> => {
    const detached = restore(label);
    if (detached) await detached.handle.close();
  };
  const redockAll = (): Promise<void> => Promise.all([...windows.keys()].map(redock)).then(() => undefined);
  const sendInit = (label: string, detached: DetachedWindow): Promise<void> =>
    options.adapter.emitTo(label, "rune:view-window-init", {
      transfer: detached.transfer,
      context: options.context(),
    });

  return {
    async start(): Promise<void> {
      unlisten.push(
        await options.adapter.listen("rune:view-window-ready", (payload) => {
          const label = windowLabel(payload);
          const detached = label ? windows.get(label) : null;
          if (detached) void sendInit(label!, detached);
          else if (label && opening.has(label)) ready.add(label);
        }),
        await options.adapter.listen("rune:view-window-redock", (payload) => {
          const label = windowLabel(payload);
          if (label) void redock(label);
        }),
        await options.adapter.listen("rune:view-window-action", (payload) => {
          const label = windowLabel(payload);
          if (!label || !windows.has(label)) return;
          const action = payload as Record<string, unknown>;
          const detached = windows.get(label)!;
          if (action.type === "active-view" && typeof action.viewId === "string"
            && detached.transfer.group.viewIds.includes(action.viewId as WorkbenchViewId)) {
            detached.transfer.group.activeViewId = action.viewId as WorkbenchViewId;
            if (detached.persisted) detached.persisted.activeViewId = action.viewId as WorkbenchViewId;
            changed();
            return;
          }
          void options.onAction(payload).then(
            (value) => {
              const id = requestId(payload);
              if (id) void options.adapter.emitTo(label, "rune:view-window-action-result", { requestId: id, ok: true, value });
            },
            (error) => {
              const id = requestId(payload);
              if (id) void options.adapter.emitTo(label, "rune:view-window-action-result", {
                requestId: id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          );
        }),
      );
    },

    has(label: string): boolean {
      return windows.has(label);
    },

    detachedWindows(): string[] {
      return [...windows.keys()];
    },

    layoutSnapshot,

    async broadcastContext(): Promise<void> {
      const context = options.context();
      await Promise.all([...windows.keys()].map((label) =>
        options.adapter.emitTo(label, "rune:view-window-context", context)));
    },

    async broadcastPresentation(): Promise<void> {
      const presentation = options.presentation();
      await Promise.all([...windows.keys()].map((label) =>
        options.adapter.emitTo(label, "rune:view-window-presentation", presentation)));
    },

    redockAll,

    reconcileLayout(): void {
      const snapshot = options.snapshot();
      for (const [label, detached] of windows) {
        const group = snapshot.viewGroups[detached.containerId].groups[detached.groupId];
        if (!group || group.viewIds.length !== detached.transfer.group.viewIds.length
          || group.viewIds.some((viewId, index) => viewId !== detached.transfer.group.viewIds[index])) void redock(label);
      }
    },

    async tearOff(containerId: WorkbenchContainerId, groupId: string, restored?: PersistedViewWindow, recoveredBounds?: WindowBounds): Promise<string> {
      const group = options.snapshot().viewGroups[containerId].groups[groupId];
      if (!group || group.viewIds.length === 0 || !group.activeViewId) throw new Error("View group is not detachable");
      const label = `view-${++nextWindow}`;
      const transfer: ViewWindowTransfer = {
        version: 1,
        transferId: `${options.sourceWindowLabel}:${label}`,
        sourceWindowLabel: options.sourceWindowLabel,
        targetWindowLabel: label,
        sourceContainerId: containerId,
        group: { ...group, viewIds: [...group.viewIds], activeViewId: restored?.activeViewId ?? group.activeViewId },
        presentation: options.presentation(),
      };
      opening.add(label);
      let handle: ViewWindowHandle;
      try {
        handle = await options.adapter.create(label, {
          url: "view.html",
          title: "Rune",
          width: 420,
          height: 640,
          minWidth: 280,
          minHeight: 240,
          bounds: recoveredBounds,
        });
      } catch (error) {
        opening.delete(label);
        ready.delete(label);
        throw error;
      }
      const detached: DetachedWindow = { containerId, groupId, handle, transfer, persisted: restored ?? null };
      windows.set(label, detached);
      opening.delete(label);
      handle.onClosed(() => { restore(label); });
      if (handle.onGeometryChanged) {
        try { detached.stopGeometry = await handle.onGeometryChanged(() => { void capture(label); }); }
        catch (error) { console.warn(error); }
      }
      options.setViewGroupDetached(containerId, groupId, true);
      if (ready.delete(label)) void sendInit(label, windows.get(label)!);
      void handle.focus().catch((error) => console.warn(error));
      await capture(label).catch((error) => console.warn(error));
      changed();
      return label;
    },

    async restoreLayout(layout: ViewWindowLayoutSnapshot): Promise<void> {
      sessionState = "running";
      const screen = await options.adapter.screen?.();
      for (const saved of layout.windows) {
        const recovered = screen ? recoverWindowBounds(saved, screen.monitors, screen.primaryName) : saved.bounds;
        await this.tearOff(saved.containerId, saved.groupId, saved, recovered).catch((error) => console.warn(error));
      }
      changed();
    },

    async prepareForShutdown(): Promise<void> {
      shuttingDown = true;
      sessionState = "clean";
      await Promise.all([...windows.keys()].map(capture));
      changed();
    },

    cancelShutdown(): void {
      shuttingDown = false;
      sessionState = "running";
      changed();
    },

    async destroy(): Promise<void> {
      unlisten.splice(0).forEach((stop) => stop());
      await redockAll();
    },
  };
}
