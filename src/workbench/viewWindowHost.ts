import type { FileNode } from "../ipc/bindings";
import type { BacklinksPanelState } from "../workspace/backlinksPanel";
import type { ReferencesPanelState } from "../workspace/referencesPanel";
import { applyDockPlan, planDock } from "./dockTransaction";
import { hitDockZone, toPhysicalScreenRect } from "./dockGeometry";
import type { DockPayload, DockSurface, DockWorkspaceSnapshot, DockZone } from "./dockTypes";
import type { WorkbenchContainerId, WorkbenchLayoutSnapshot, WorkbenchViewId } from "./workbenchLayout";
import {
  DOCK_PROTOCOL_EVENT,
  normalizeDockProtocolMessage,
  type DockProtocolMessage,
  type ViewWindowPresentation,
  type ViewWindowTransfer,
} from "./viewWindowTransfer";
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
  startDragging?(): Promise<void>;
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
  cursor?(): Promise<{ x: number; y: number }>;
  screen?(): Promise<{ monitors: AvailableMonitor[]; primaryName: string | null }>;
}

export interface ViewWindowHostOptions {
  adapter: ViewWindowAdapter;
  sourceWindowLabel: string;
  snapshot(): WorkbenchLayoutSnapshot;
  setViewGroupDetached(containerId: WorkbenchContainerId, groupId: string, detached: boolean): void;
  presentation(): ViewWindowPresentation;
  context(): ViewWindowContext;
  onAction(payload: unknown): Promise<unknown>;
  onLayoutChange?(snapshot: ViewWindowLayoutSnapshot): void;
  dockSnapshot?(): DockWorkspaceSnapshot;
  commitDockSnapshot?(snapshot: DockWorkspaceSnapshot): void;
  dockSurfaces?(): Promise<DockSurface[]>;
  renderMainDockPreview?(message: Extract<DockProtocolMessage, { type: "dock:preview" }> | null): void;
  readyTimeoutMs?: number;
  dockAckTimeoutMs?: number;
  nativeDragIdleMs?: number;
  nativeDragStartTimeoutMs?: number;
}

interface DetachedWindow {
  /** Active group convenience fields; ownership is authoritative in transfer.groups. */
  containerId: WorkbenchContainerId;
  groupId: string;
  handle: ViewWindowHandle;
  transfer: ViewWindowTransfer;
  persisted: PersistedViewWindow | null;
  stopGeometry?: () => void;
}

interface CrossWindowDockSession {
  id: string;
  sourceWindowLabel: string;
  payload: DockPayload;
  original: DockWorkspaceSnapshot;
  surfaces: Map<string, DockSurface>;
  selected: DockZone | null;
  previewWindowLabel: string | null;
  point: { x: number; y: number };
  committing: boolean;
}

interface DetachedWindowBackup {
  containerId: WorkbenchContainerId;
  groupId: string;
  transfer: ViewWindowTransfer;
  persisted: PersistedViewWindow | null;
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
  const readyWaiters = new Map<string, { resolve(): void; timer: ReturnType<typeof setTimeout> }>();
  const dockResultWaiters = new Map<string, {
    targetWindowLabel: string;
    resolve(message: Extract<DockProtocolMessage, { type: "dock:result" }>): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const seenDockSessions = new Set<string>();
  const closingDockWindows = new Set<string>();
  const unlisten: Array<() => void> = [];
  let nextWindow = 0;
  let sessionState: ViewWindowLayoutSnapshot["sessionState"] = "running";
  let shuttingDown = false;
  let dockTransactionActive = false;
  let activeDockSession: CrossWindowDockSession | null = null;
  let nextDockSession = 0;
  const readyTimeoutMs = Math.max(1, options.readyTimeoutMs ?? 5_000);
  const dockAckTimeoutMs = Math.max(1, options.dockAckTimeoutMs ?? 3_000);
  const nativeDragIdleMs = Math.max(1, options.nativeDragIdleMs ?? 600);
  const nativeDragStartTimeoutMs = Math.max(nativeDragIdleMs, options.nativeDragStartTimeoutMs ?? 1_500);
  const nativeDragMovement = new Map<string, () => void>();

  const waitForNativeDragEnd = async (label: string, startDragging: () => Promise<void>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    let finish!: () => void;
    const movementSettled = new Promise<void>((resolve) => {
      finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        nativeDragMovement.delete(label);
        resolve();
      };
      timer = setTimeout(finish, nativeDragStartTimeoutMs);
      nativeDragMovement.set(label, () => {
        clearTimeout(timer);
        timer = setTimeout(finish, nativeDragIdleMs);
      });
    });
    try {
      await startDragging();
      await movementSettled;
    } catch (error) {
      finish();
      throw error;
    }
  };

  const waitUntilReady = (label: string): Promise<void> => {
    if (ready.delete(label)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        readyWaiters.delete(label);
        reject(new Error(`Native View window ${label} was not ready before timeout`));
      }, readyTimeoutMs);
      readyWaiters.set(label, { timer, resolve: () => { clearTimeout(timer); readyWaiters.delete(label); resolve(); } });
    });
  };

  const monitorForPoint = async (point: { x: number; y: number }): Promise<{
    bounds: WindowBounds;
    monitor: WindowMonitorSnapshot;
  }> => {
    const screen = await options.adapter.screen?.();
    const monitor = screen?.monitors.find(({ workArea }) => point.x >= workArea.x && point.y >= workArea.y
      && point.x < workArea.x + workArea.width && point.y < workArea.y + workArea.height)
      ?? screen?.monitors.find((item) => item.name === screen.primaryName)
      ?? screen?.monitors[0];
    const area = monitor?.workArea ?? { x: point.x - 210, y: point.y - 320, width: 420, height: 640 };
    const width = Math.min(420, area.width);
    const height = Math.min(640, area.height);
    const bounds = {
      x: Math.min(area.x + area.width - width, Math.max(area.x, Math.round(point.x - width / 2))),
      y: Math.min(area.y + area.height - height, Math.max(area.y, Math.round(point.y - height / 2))),
      width,
      height,
    };
    return {
      bounds,
      monitor: {
        name: monitor?.name ?? null,
        scaleFactor: monitor?.scaleFactor ?? 1,
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
      },
    };
  };

  const layoutSnapshot = (): ViewWindowLayoutSnapshot => ({
    version: 2,
    sessionState,
    windows: [...windows.values()].flatMap((window) => window.persisted ? [structuredClone(window.persisted)] : []),
  });
  const setDetachedProjection = (detached: DetachedWindow, value: boolean): void => {
    for (const projected of detached.transfer.groups) {
      options.setViewGroupDetached(projected.containerId, projected.group.id, value);
    }
  };
  const transferFor = (
    label: string,
    saved: PersistedViewWindow,
    snapshot = options.snapshot(),
  ): ViewWindowTransfer | null => {
    const groups: ViewWindowTransfer["groups"] = [];
    for (const reference of saved.groups) {
      const group = snapshot.viewGroups[reference.containerId]?.groups[reference.groupId];
      if (!group?.activeViewId || group.viewIds.length === 0) return null;
      groups.push({
        containerId: reference.containerId,
        group: {
          ...structuredClone(group),
          activeViewId: reference.groupId === saved.activeGroupId ? saved.activeViewId : group.activeViewId,
        },
      });
    }
    return {
      version: 2,
      transferId: `${options.sourceWindowLabel}:${label}`,
      sourceWindowLabel: options.sourceWindowLabel,
      targetWindowLabel: label,
      groups,
      root: structuredClone(saved.root),
      activeGroupId: saved.activeGroupId,
      presentation: options.presentation(),
    };
  };
  const changed = (): void => options.onLayoutChange?.(layoutSnapshot());
  const capture = async (label: string): Promise<void> => {
    const detached = windows.get(label);
    if (!detached?.handle.capture) return;
    const placement = await detached.handle.capture();
    if (windows.get(label) !== detached) return;
    const active = detached.transfer.groups.find((group) => group.group.id === detached.transfer.activeGroupId)
      ?? detached.transfer.groups[0];
    detached.persisted = {
      label,
      groups: detached.transfer.groups.map((group) => ({ containerId: group.containerId, groupId: group.group.id })),
      root: structuredClone(detached.transfer.root),
      activeGroupId: active.group.id,
      activeViewId: active.group.activeViewId!,
      ...placement,
    };
    changed();
  };

  const restore = (label: string): DetachedWindow | null => {
    const detached = windows.get(label);
    if (!detached) return null;
    if (closingDockWindows.has(label)) return detached;
    const session = activeDockSession;
    if (session && (session.sourceWindowLabel === label || session.previewWindowLabel === label
      || session.surfaces.has(label))) void finishDockSession(session, "window-loss");
    windows.delete(label);
    detached.stopGeometry?.();
    setDetachedProjection(detached, false);
    if (!shuttingDown) changed();
    return detached;
  };

  const redock = async (label: string): Promise<void> => {
    const detached = restore(label);
    if (detached) await detached.handle.close();
  };
  const redockAll = (): Promise<void> => Promise.all([...windows.keys()].map(redock)).then(() => undefined);
  const sendInit = async (label: string, detached: DetachedWindow): Promise<void> => {
    await options.adapter.emitTo(label, "rune:view-window-init", {
      transfer: detached.transfer,
      revision: options.dockSnapshot?.().revision ?? 0,
    });
    await options.adapter.emitTo(label, "rune:view-window-context", options.context());
  };

  const sourceMatchesSnapshot = (snapshot: DockWorkspaceSnapshot, payload: DockPayload): boolean => {
    const group = snapshot.workbench.viewGroups[payload.source.containerId]?.groups[payload.source.groupId];
    if (!group) return false;
    if (payload.source.windowLabel === options.sourceWindowLabel) {
      if (snapshot.viewWindows.windows.some((item) => item.groups.some((reference) =>
        reference.containerId === payload.source.containerId && reference.groupId === payload.source.groupId))) return false;
    } else {
      const saved = snapshot.viewWindows.windows.find((item) => item.label === payload.source.windowLabel);
      if (!saved?.groups.some((reference) => reference.containerId === payload.source.containerId
        && reference.groupId === payload.source.groupId)) return false;
    }
    if (payload.kind === "view") return group.viewIds.includes(payload.viewId)
      && snapshot.workbench.views[payload.viewId]?.containerId === payload.source.containerId;
    return payload.viewIds.length === group.viewIds.length
      && payload.viewIds.every((id, position) => id === group.viewIds[position])
      && payload.viewIds.includes(payload.activeViewId)
      && payload.viewIds.every((id) => snapshot.workbench.views[id]?.containerId === payload.source.containerId);
  };

  const surfaceContains = (surface: DockSurface, point: { x: number; y: number }): boolean => {
    const rects = surface.viewport
      ? [toPhysicalScreenRect(surface.viewport, surface.metrics)]
      : surface.zones.map((zone) => toPhysicalScreenRect(zone.rect, surface.metrics));
    return rects.some((rect) => rect.width > 0 && rect.height > 0
      && point.x >= rect.x && point.x < rect.x + rect.width
      && point.y >= rect.y && point.y < rect.y + rect.height);
  };

  const protocol = <T extends DockProtocolMessage>(target: string, message: T): Promise<void> =>
    options.adapter.emitTo(target, DOCK_PROTOCOL_EVENT, message);

  const clearPreviewWindow = async (session: CrossWindowDockSession, label: string): Promise<void> => {
    if (label === options.sourceWindowLabel) {
      options.renderMainDockPreview?.(null);
      return;
    }
    await protocol(label, {
      type: "dock:preview",
      version: 2,
      sessionId: session.id,
      sourceWindowLabel: options.sourceWindowLabel,
      targetWindowLabel: label,
      payload: structuredClone(session.payload),
      zone: null,
      point: { ...session.point },
    });
  };

  const showSelectedPreview = async (session: CrossWindowDockSession, zone: DockZone | null): Promise<void> => {
    const nextLabel = zone?.target.kind === "new-window" ? null : zone?.target.windowLabel ?? null;
    if (session.previewWindowLabel && session.previewWindowLabel !== nextLabel) {
      await clearPreviewWindow(session, session.previewWindowLabel).catch(() => {});
    }
    session.previewWindowLabel = nextLabel;
    if (!nextLabel || !zone) return;
    const message: Extract<DockProtocolMessage, { type: "dock:preview" }> = {
      type: "dock:preview",
      version: 2,
      sessionId: session.id,
      sourceWindowLabel: options.sourceWindowLabel,
      targetWindowLabel: nextLabel,
      payload: structuredClone(session.payload),
      zone: structuredClone(zone),
      point: { ...session.point },
    };
    if (nextLabel === options.sourceWindowLabel) options.renderMainDockPreview?.(message);
    else await protocol(nextLabel, message);
  };

  const selectDockZone = async (session: CrossWindowDockSession, point: { x: number; y: number }): Promise<DockZone | null> => {
    session.point = { ...point };
    const local = await options.dockSurfaces?.().catch(() => []) ?? [];
    const surfaces = [...local, ...session.surfaces.values()]
      .filter((surface) => surface.revision === session.original.revision
        && surface.windowLabel !== session.sourceWindowLabel);
    const matches = surfaces.flatMap((surface) => {
      if (!surfaceContains(surface, point)) return [];
      const zone = hitDockZone(surface, point);
      return zone ? [{ surface, zone }] : [];
    });
    matches.sort((left, right) => right.zone.priority - left.zone.priority
      || left.surface.windowLabel.localeCompare(right.surface.windowLabel)
      || left.zone.id.localeCompare(right.zone.id));
    const selected = matches[0]?.zone ?? null;
    session.selected = selected;
    await showSelectedPreview(session, selected);
    return selected;
  };

  const finishDockSession = async (session: CrossWindowDockSession, reason: string): Promise<void> => {
    if (activeDockSession === session) activeDockSession = null;
    if (session.previewWindowLabel) await clearPreviewWindow(session, session.previewWindowLabel).catch(() => {});
    for (const label of windows.keys()) {
      await protocol(label, {
        type: "dock:cancel",
        version: 2,
        sessionId: session.id,
        sourceWindowLabel: options.sourceWindowLabel,
        reason,
      }).catch(() => {});
    }
  };

  const backupDetachedWindows = (): Map<string, DetachedWindowBackup> => new Map(
    [...windows].map(([label, detached]) => [label, {
      containerId: detached.containerId,
      groupId: detached.groupId,
      transfer: structuredClone(detached.transfer),
      persisted: detached.persisted ? structuredClone(detached.persisted) : null,
    }]),
  );

  const restoreDetachedWindows = async (backup: Map<string, DetachedWindowBackup>): Promise<void> => {
    for (const [label, saved] of backup) {
      const detached = windows.get(label);
      if (!detached) continue;
      detached.containerId = saved.containerId;
      detached.groupId = saved.groupId;
      detached.transfer = structuredClone(saved.transfer);
      detached.persisted = saved.persisted ? structuredClone(saved.persisted) : null;
      const active = detached.transfer.groups.find((group) => group.group.id === detached.transfer.activeGroupId)
        ?? detached.transfer.groups[0];
      detached.containerId = active.containerId;
      detached.groupId = active.group.id;
      setDetachedProjection(detached, true);
      await sendInit(label, detached).catch(() => {});
    }
  };

  const projectDetachedWindows = (snapshot: DockWorkspaceSnapshot): string[] => {
    const updated: string[] = [];
    snapshot.viewWindows.windows.forEach((saved) => {
      const label = saved.label;
      const detached = windows.get(label);
      const transfer = transferFor(label, saved, snapshot.workbench);
      if (!detached || !transfer) return;
      const active = transfer.groups.find((group) => group.group.id === transfer.activeGroupId) ?? transfer.groups[0];
      detached.containerId = active.containerId;
      detached.groupId = active.group.id;
      detached.persisted = structuredClone(saved);
      detached.transfer = transfer;
      updated.push(label);
    });
    return updated;
  };

  const waitForDockResult = (session: CrossWindowDockSession, targetWindowLabel: string): Promise<Extract<DockProtocolMessage, { type: "dock:result" }>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        dockResultWaiters.delete(session.id);
        reject(new Error(`Dock target ${targetWindowLabel} did not acknowledge render`));
      }, dockAckTimeoutMs);
      dockResultWaiters.set(session.id, { targetWindowLabel, timer, resolve: (message) => {
        clearTimeout(timer);
        dockResultWaiters.delete(session.id);
        resolve(message);
      } });
    });

  const clearDockResultWaiter = (sessionId: string): void => {
    const waiter = dockResultWaiters.get(sessionId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    dockResultWaiters.delete(sessionId);
  };

  const commitDockSession = async (session: CrossWindowDockSession): Promise<boolean> => {
    if (!options.dockSnapshot || !options.commitDockSnapshot || !session.selected || session.committing) return false;
    session.committing = true;
    const latest = options.dockSnapshot();
    if (JSON.stringify(latest) !== JSON.stringify(session.original)) {
      await finishDockSession(session, "source-loss");
      return false;
    }
    const plan = planDock(latest, session.payload, session.selected.target);
    if (!plan.ok) {
      await finishDockSession(session, plan.reason);
      return false;
    }
    const applied = applyDockPlan(latest, plan);
    if (!applied.ok) {
      await finishDockSession(session, applied.reason);
      return false;
    }
    const targetWindowLabel = session.selected.target.kind === "new-window"
      ? null
      : session.selected.target.windowLabel;
    if (!targetWindowLabel) {
      await finishDockSession(session, "invalid-target");
      return false;
    }
    const backup = backupDetachedWindows();
    dockTransactionActive = true;
    let committed = false;
    try {
      let acknowledgement: Promise<Extract<DockProtocolMessage, { type: "dock:result" }>> | null = null;
      if (targetWindowLabel !== options.sourceWindowLabel) {
        if (!windows.has(targetWindowLabel)) throw new Error("Dock target window was lost");
        acknowledgement = waitForDockResult(session, targetWindowLabel);
      }
      options.commitDockSnapshot(applied.snapshot);
      committed = true;
      const projected = projectDetachedWindows(applied.snapshot);
      if (targetWindowLabel !== options.sourceWindowLabel) {
        await protocol(targetWindowLabel, {
          type: "dock:commit",
          version: 2,
          sessionId: session.id,
          sourceWindowLabel: options.sourceWindowLabel,
          target: structuredClone(session.selected.target),
          revision: applied.snapshot.revision,
        });
        const target = windows.get(targetWindowLabel);
        if (!target) throw new Error("Dock target window was lost");
        await sendInit(targetWindowLabel, target);
        const result = await acknowledgement!;
        if (!result.ok || result.revision !== applied.snapshot.revision) throw new Error(result.error ?? "Dock target rejected render");
      }
      for (const label of projected) {
        if (label === targetWindowLabel) continue;
        const detached = windows.get(label);
        if (detached) await sendInit(label, detached);
      }
      await protocol(session.sourceWindowLabel, {
        type: "dock:result",
        version: 2,
        sessionId: session.id,
        sourceWindowLabel: options.sourceWindowLabel,
        ok: true,
        revision: applied.snapshot.revision,
        error: null,
      }).catch(() => {});
      for (const effect of applied.effects) {
        if (effect.kind !== "close-window") continue;
        const detached = windows.get(effect.windowLabel);
        if (!detached) continue;
        closingDockWindows.add(effect.windowLabel);
        try {
          await detached.handle.close();
          windows.delete(effect.windowLabel);
          detached.stopGeometry?.();
        } finally {
          closingDockWindows.delete(effect.windowLabel);
        }
      }
      for (const detached of windows.values()) setDetachedProjection(detached, true);
      changed();
      await finishDockSession(session, "committed");
      return true;
    } catch (error) {
      clearDockResultWaiter(session.id);
      if (committed) options.commitDockSnapshot(session.original);
      await restoreDetachedWindows(backup);
      await protocol(session.sourceWindowLabel, {
        type: "dock:result",
        version: 2,
        sessionId: session.id,
        sourceWindowLabel: options.sourceWindowLabel,
        ok: false,
        revision: session.original.revision,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
      await finishDockSession(session, "rollback");
      return false;
    } finally {
      dockTransactionActive = false;
    }
  };

  const beginDockSession = async (
    message: Extract<DockProtocolMessage, { type: "dock:start" }>,
    propagateNativeFailure = false,
  ): Promise<boolean> => {
    const rejectStart = async (reason: string): Promise<boolean> => {
      if (!propagateNativeFailure) await protocol(message.sourceWindowLabel, {
        type: "dock:cancel",
        version: 2,
        sessionId: message.sessionId,
        sourceWindowLabel: options.sourceWindowLabel,
        reason,
      }).catch(() => {});
      return false;
    };
    if (!options.dockSnapshot) return rejectStart("native-docking-disabled");
    if (seenDockSessions.has(message.sessionId)) return false;
    const source = windows.get(message.sourceWindowLabel);
    const original = options.dockSnapshot();
    if (!source?.handle.startDragging) return rejectStart("source-loss");
    if (!sourceMatchesSnapshot(original, message.payload)) return rejectStart("invalid-source");
    if (!options.dockSurfaces || !options.adapter.cursor) {
      await waitForNativeDragEnd(message.sourceWindowLabel, () => source.handle.startDragging!());
      return false;
    }
    if (activeDockSession) await finishDockSession(activeDockSession, "competing-session");
    seenDockSessions.add(message.sessionId);
    if (seenDockSessions.size > 1_024) seenDockSessions.delete(seenDockSessions.values().next().value!);
    const session: CrossWindowDockSession = {
      id: message.sessionId,
      sourceWindowLabel: message.sourceWindowLabel,
      payload: structuredClone(message.payload),
      original,
      surfaces: new Map(),
      selected: null,
      previewWindowLabel: null,
      point: { ...message.point },
      committing: false,
    };
    activeDockSession = session;
    await Promise.all([...windows.keys()].filter((label) => label !== session.sourceWindowLabel).map((label) =>
      protocol(label, message).catch(() => {})));
    try {
      await waitForNativeDragEnd(message.sourceWindowLabel, () => source.handle.startDragging!());
      if (activeDockSession !== session) return false;
      const point = await options.adapter.cursor();
      const zone = await selectDockZone(session, point);
      if (!zone) {
        await finishDockSession(session, "invalid-drop");
        return false;
      }
      return commitDockSession(session);
    } catch (error) {
      await finishDockSession(session, "native-drag-failed");
      if (propagateNativeFailure) throw error;
      return false;
    }
  };

  const onNativeWindowGeometryChanged = (label: string): void => {
    const session = activeDockSession;
    if (session?.sourceWindowLabel === label) {
      nativeDragMovement.get(label)?.();
      if (!session.committing && options.adapter.cursor) {
        void options.adapter.cursor().then((point) => selectDockZone(session, point)).catch(() => {});
      }
      return;
    }
    void capture(label);
  };

  return {
    async start(): Promise<void> {
      unlisten.push(
        await options.adapter.listen("rune:view-window-ready", (payload) => {
          const label = windowLabel(payload);
          const waiter = label ? readyWaiters.get(label) : null;
          if (waiter) {
            waiter.resolve();
            return;
          }
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
          const activeProjection = action.type === "active-view" && typeof action.viewId === "string"
            ? detached.transfer.groups.find((projected) => projected.group.viewIds.includes(action.viewId as WorkbenchViewId))
            : null;
          if (activeProjection && typeof action.viewId === "string") {
            activeProjection.group.activeViewId = action.viewId as WorkbenchViewId;
            detached.transfer.activeGroupId = activeProjection.group.id;
            detached.containerId = activeProjection.containerId;
            detached.groupId = activeProjection.group.id;
            if (detached.persisted) {
              detached.persisted.activeGroupId = activeProjection.group.id;
              detached.persisted.activeViewId = action.viewId as WorkbenchViewId;
            }
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
        await options.adapter.listen(DOCK_PROTOCOL_EVENT, (payload) => {
          const message = normalizeDockProtocolMessage(payload);
          if (!message) return;
          if (message.type === "dock:start") {
            if (message.sourceWindowLabel === options.sourceWindowLabel || !windows.has(message.sourceWindowLabel)) return;
            void beginDockSession(message);
            return;
          }
          if (message.type === "dock:surface") {
            const session = activeDockSession;
            if (!session || session.committing || message.sessionId !== session.id || !windows.has(message.sourceWindowLabel)
              || message.surface.revision !== session.original.revision) return;
            session.surfaces.set(message.sourceWindowLabel, message.surface);
            if (options.adapter.cursor) void options.adapter.cursor().then((point) => selectDockZone(session, point)).catch(() => {});
            return;
          }
          if (message.type === "dock:result") {
            const waiter = dockResultWaiters.get(message.sessionId);
            if (!waiter || waiter.targetWindowLabel !== message.sourceWindowLabel) return;
            waiter.resolve(message);
            return;
          }
          if (message.type === "dock:cancel") {
            const session = activeDockSession;
            if (session && message.sessionId === session.id && message.sourceWindowLabel === session.sourceWindowLabel) {
              void finishDockSession(session, message.reason);
            }
          }
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
      if (dockTransactionActive) return;
      const snapshot = options.snapshot();
      for (const [label, detached] of windows) {
        const stale = detached.transfer.groups.some((projected) => {
          const group = snapshot.viewGroups[projected.containerId].groups[projected.group.id];
          return !group || group.viewIds.length !== projected.group.viewIds.length
            || group.viewIds.some((viewId, index) => viewId !== projected.group.viewIds[index]);
        });
        if (stale) void redock(label);
      }
    },

    async tearOff(containerId: WorkbenchContainerId, groupId: string, restored?: PersistedViewWindow, recoveredBounds?: WindowBounds): Promise<string> {
      const snapshot = options.snapshot();
      const group = snapshot.viewGroups[containerId].groups[groupId];
      if (!group || group.viewIds.length === 0 || !group.activeViewId) throw new Error("View group is not detachable");
      const label = restored?.label ?? `view-${++nextWindow}`;
      const restoredIndex = /^view-([1-9]\d*)$/.exec(label);
      if (restoredIndex) nextWindow = Math.max(nextWindow, Number(restoredIndex[1]));
      const saved: PersistedViewWindow = restored ?? {
        label,
        groups: [{ containerId, groupId }],
        root: { type: "group", groupId },
        activeGroupId: groupId,
        activeViewId: group.activeViewId,
        bounds: recoveredBounds ?? { x: 0, y: 0, width: 420, height: 640 },
        monitor: { name: null, scaleFactor: 1, x: 0, y: 0, width: 420, height: 640 },
      };
      const transfer = transferFor(label, saved, snapshot);
      if (!transfer) throw new Error("View window projection is not restorable");
      const active = transfer.groups.find((projected) => projected.group.id === transfer.activeGroupId) ?? transfer.groups[0];
      opening.add(label);
      const readiness = restored ? waitUntilReady(label) : null;
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
        const waiter = readyWaiters.get(label);
        if (waiter) {
          clearTimeout(waiter.timer);
          readyWaiters.delete(label);
        }
        throw error;
      }
      const detached: DetachedWindow = {
        containerId: active.containerId,
        groupId: active.group.id,
        handle,
        transfer,
        persisted: structuredClone(saved),
      };
      windows.set(label, detached);
      opening.delete(label);
      handle.onClosed(() => { restore(label); });
      if (handle.onGeometryChanged) {
        try { detached.stopGeometry = await handle.onGeometryChanged(() => onNativeWindowGeometryChanged(label)); }
        catch (error) { console.warn(error); }
      }
      if (readiness) {
        try {
          await readiness;
          setDetachedProjection(detached, true);
          await sendInit(label, detached);
          await handle.focus();
          await capture(label).catch((error) => console.warn(error));
          changed();
          return label;
        } catch (error) {
          windows.delete(label);
          detached.stopGeometry?.();
          setDetachedProjection(detached, false);
          await handle.close().catch(() => {});
          throw error;
        }
      }
      setDetachedProjection(detached, true);
      if (ready.delete(label)) void sendInit(label, windows.get(label)!);
      void handle.focus().catch((error) => console.warn(error));
      await capture(label).catch((error) => console.warn(error));
      changed();
      return label;
    },

    async tearOffPayload(payload: DockPayload, point: { x: number; y: number }): Promise<string> {
      if (!options.dockSnapshot || !options.commitDockSnapshot) {
        throw new Error("Pointer tear-off requires an authoritative DockWorkspace snapshot");
      }
      const original = options.dockSnapshot();
      const label = `view-${++nextWindow}`;
      const placement = await monitorForPoint(point);
      opening.add(label);
      let handle: ViewWindowHandle | null = null;
      let detached: DetachedWindow | null = null;
      let committed = false;
      let hidden = false;
      try {
        handle = await options.adapter.create(label, {
          url: "view.html",
          title: "Rune",
          width: 420,
          height: 640,
          minWidth: 280,
          minHeight: 240,
          bounds: placement.bounds,
        });
        await waitUntilReady(label);
        const latest = options.dockSnapshot();
        if (JSON.stringify(latest) !== JSON.stringify(original)) throw new Error("Dock source changed while opening the native window");
        const plan = planDock(original, payload, { kind: "new-window", bounds: placement.bounds });
        if (!plan.ok) throw new Error(`Native tear-off DockPlan rejected: ${plan.reason}`);
        const applied = applyDockPlan(original, plan);
        if (!applied.ok) throw new Error(`Native tear-off DockPlan could not be applied: ${applied.reason}`);
        const saved = applied.snapshot.viewWindows.windows.find((window) => window.label === label) ?? null;
        const effect = applied.effects.find((candidate) => candidate.kind === "open-window" && candidate.windowLabel === label);
        if (!saved || effect?.kind !== "open-window") throw new Error("Native tear-off window label did not match its DockPlan");
        saved.monitor = placement.monitor;
        const transfer = transferFor(label, saved, applied.snapshot.workbench);
        if (!transfer) throw new Error("Native tear-off produced an invalid detached group tree");
        const active = transfer.groups.find((projected) => projected.group.id === transfer.activeGroupId) ?? transfer.groups[0];
        detached = {
          containerId: active.containerId,
          groupId: active.group.id,
          handle,
          transfer,
          persisted: structuredClone(saved),
        };
        windows.set(label, detached);
        handle.onClosed(() => { restore(label); });
        options.commitDockSnapshot(applied.snapshot);
        committed = true;
        setDetachedProjection(detached, true);
        hidden = true;
        await sendInit(label, detached);
        await handle.focus();
        if (!handle.startDragging) throw new Error("Native View window cannot start dragging");
        if (handle.onGeometryChanged) {
          try { detached.stopGeometry = await handle.onGeometryChanged(() => onNativeWindowGeometryChanged(label)); }
          catch (error) { console.warn(error); }
        }
        const detachedPayload: DockPayload = payload.kind === "view"
          ? {
            kind: "view",
            viewId: payload.viewId,
            source: { windowLabel: label, containerId: active.containerId, groupId: active.group.id },
          }
          : {
            kind: "group",
            viewIds: [...payload.viewIds],
            activeViewId: payload.activeViewId,
            source: { windowLabel: label, containerId: active.containerId, groupId: active.group.id },
          };
        await beginDockSession({
          type: "dock:start",
          version: 2,
          sessionId: `${label}:${++nextDockSession}`,
          sourceWindowLabel: label,
          payload: detachedPayload,
          point: { ...point },
        }, true);
        await capture(label).catch((error) => console.warn(error));
        changed();
        return label;
      } catch (error) {
        if (detached) {
          windows.delete(label);
          detached.stopGeometry?.();
        }
        if (hidden && detached) setDetachedProjection(detached, false);
        if (committed) options.commitDockSnapshot(original);
        if (handle) await handle.close().catch(() => {});
        throw error;
      } finally {
        opening.delete(label);
        ready.delete(label);
        const waiter = readyWaiters.get(label);
        if (waiter) {
          clearTimeout(waiter.timer);
          readyWaiters.delete(label);
        }
      }
    },

    async restoreLayout(layout: ViewWindowLayoutSnapshot): Promise<void> {
      sessionState = "running";
      const screen = await options.adapter.screen?.();
      for (const saved of layout.windows) {
        const recovered = screen ? recoverWindowBounds(saved, screen.monitors, screen.primaryName) : saved.bounds;
        const first = saved.groups[0];
        if (!first) continue;
        await this.tearOff(first.containerId, first.groupId, saved, recovered).catch((error) => console.warn(error));
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
      for (const waiter of readyWaiters.values()) clearTimeout(waiter.timer);
      readyWaiters.clear();
      for (const waiter of dockResultWaiters.values()) clearTimeout(waiter.timer);
      dockResultWaiters.clear();
      if (activeDockSession) await finishDockSession(activeDockSession, "host-destroyed");
      await redockAll();
    },
  };
}
