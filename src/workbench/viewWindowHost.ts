import type { FileNode } from "../ipc/bindings";
import type { BacklinksPanelState } from "../workspace/backlinksPanel";
import type { ReferencesPanelState } from "../workspace/referencesPanel";
import type { WorkbenchContainerId, WorkbenchLayoutSnapshot } from "./workbenchLayout";
import type { ViewWindowPresentation, ViewWindowTransfer } from "./viewWindowTransfer";

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
}

export interface ViewWindowAdapter {
  create(label: string, options: {
    url: string;
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  }): Promise<ViewWindowHandle>;
  emitTo(target: string, event: string, payload: unknown): Promise<void>;
  listen(event: string, listener: (payload: unknown) => void): Promise<() => void>;
}

interface ViewWindowHostOptions {
  adapter: ViewWindowAdapter;
  sourceWindowLabel: string;
  snapshot(): WorkbenchLayoutSnapshot;
  setViewGroupDetached(containerId: WorkbenchContainerId, groupId: string, detached: boolean): void;
  presentation(): ViewWindowPresentation;
  context(): ViewWindowContext;
  onAction(payload: unknown): Promise<unknown>;
}

interface DetachedWindow {
  containerId: WorkbenchContainerId;
  groupId: string;
  handle: ViewWindowHandle;
  transfer: ViewWindowTransfer;
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

  const restore = (label: string): DetachedWindow | null => {
    const detached = windows.get(label);
    if (!detached) return null;
    windows.delete(label);
    options.setViewGroupDetached(detached.containerId, detached.groupId, false);
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

    async tearOff(containerId: WorkbenchContainerId, groupId: string): Promise<string> {
      const group = options.snapshot().viewGroups[containerId].groups[groupId];
      if (!group || group.viewIds.length === 0 || !group.activeViewId) throw new Error("View group is not detachable");
      const label = `view-${++nextWindow}`;
      const transfer: ViewWindowTransfer = {
        version: 1,
        transferId: `${options.sourceWindowLabel}:${label}`,
        sourceWindowLabel: options.sourceWindowLabel,
        targetWindowLabel: label,
        sourceContainerId: containerId,
        group: { ...group, viewIds: [...group.viewIds] },
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
        });
      } catch (error) {
        opening.delete(label);
        ready.delete(label);
        throw error;
      }
      windows.set(label, { containerId, groupId, handle, transfer });
      opening.delete(label);
      handle.onClosed(() => { restore(label); });
      options.setViewGroupDetached(containerId, groupId, true);
      if (ready.delete(label)) void sendInit(label, windows.get(label)!);
      void handle.focus().catch((error) => console.warn(error));
      return label;
    },

    async destroy(): Promise<void> {
      unlisten.splice(0).forEach((stop) => stop());
      await redockAll();
    },
  };
}
