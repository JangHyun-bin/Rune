import "./styles.css";
if (import.meta.env.VITE_WDIO === "1") void import("@wdio/tauri-plugin");
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { parseHeadings } from "./editor/outline";
import { getLocale, setLocale, t } from "./i18n/i18n";
import { serializeProject, type PublishingProfile, type RuneProject } from "./project/project";
import type { ProjectDiagnostic } from "./project/projectPreflight";
import { firstMarkdownPath } from "./workspace/dropTargets";
import { mountBacklinksPanel } from "./workspace/backlinksPanel";
import { mountFileTree } from "./workspace/fileTree";
import { mountOutlinePanel } from "./workspace/outlinePanel";
import { mountProjectPanel } from "./workspace/projectPanel";
import { mountPropertiesPanel } from "./workspace/propertiesPanel";
import { mountReferencesPanel } from "./workspace/referencesPanel";
import { mountSearchPanel } from "./workspace/searchPanel";
import { mountTagsPanel } from "./workspace/tagsPanel";
import type { DockPayload } from "./workbench/dockTypes";
import type { WorkbenchViewId } from "./workbench/workbenchLayout";
import type { ViewWindowContext } from "./workbench/viewWindowHost";
import {
  DOCK_PROTOCOL_EVENT,
  normalizeDockProtocolMessage,
  normalizeViewWindowTransfer,
  type DockProtocolMessage,
  type ViewWindowPresentation,
  type ViewWindowTransfer,
} from "./workbench/viewWindowTransfer";
import { nextDetachedTabIndex } from "./workbench/viewWindowTabs";
import { measureDetachedDockTreeSurface } from "./workbench/dockGeometry";
import { createTauriDockDragAdapter, logicalClientPointToPhysicalScreen } from "./workbench/tauriDockDragAdapter";
import { detachedDockPayload } from "./workbench/detachedDockPayload";
import { renderViewGroupTree } from "./workbench/viewGroupTreeRenderer";

const currentWindow = getCurrentWebviewWindow();
const mainWindow = "main";
const host = document.getElementById("detached-view")!;
const dockDragAdapter = createTauriDockDragAdapter();
const nativeDockingEnabled = import.meta.env.VITE_NATIVE_DOCKING === "1";
let transfer: ViewWindowTransfer | null = null;
let context: ViewWindowContext = {
  currentFolder: null,
  activePath: null,
  activeMarkdown: null,
  activeLine: 1,
  workspaceTree: [],
  workspaceFiles: [],
  backlinks: "noDocument",
  references: "noProject",
};
let nextRequest = 0;
const requests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let refreshPanels = (): void => {};
let disposePanels = (): void => {};
let cycleTab = (_direction: 1 | -1): void => {};
let refreshDockSurface = (): void => {};
let dockRevision = 0;
let nextDockSession = 0;
let observedDockSession: Extract<DockProtocolMessage, { type: "dock:start" }> | null = null;
let pendingDockCommit: Extract<DockProtocolMessage, { type: "dock:commit" }> | null = null;
let dockOverlay: HTMLElement | null = null;

if (import.meta.env.VITE_WDIO === "1") {
  Object.assign(window, {
    __RUNE_DOCKING_RELEASE_GATE__: {
      metrics: dockDragAdapter.metrics,
      focus: () => currentWindow.setFocus(),
      toPhysical: logicalClientPointToPhysicalScreen,
      transfer: () => structuredClone(transfer),
    },
  });
  document.documentElement.dataset.wdioDockingReleaseGateReady = "true";
}

function clearDockOverlay(): void {
  dockOverlay?.remove();
  dockOverlay = null;
  document.body.classList.remove("dock-drag-active");
}

function acknowledgePendingDockCommit(): void {
  const commit = pendingDockCommit;
  if (!commit || dockRevision !== commit.revision) return;
  pendingDockCommit = null;
  void emitTo(mainWindow, DOCK_PROTOCOL_EVENT, {
    type: "dock:result",
    version: 2,
    sessionId: commit.sessionId,
    sourceWindowLabel: currentWindow.label,
    ok: true,
    revision: dockRevision,
    error: null,
  } satisfies DockProtocolMessage);
}

function renderDockOverlay(message: Extract<DockProtocolMessage, { type: "dock:preview" }>): void {
  clearDockOverlay();
  if (!message.zone) return;
  dockOverlay = document.createElement("div");
  dockOverlay.className = `dock-target-overlay dock-target-${message.zone.target.kind}`;
  dockOverlay.setAttribute("aria-hidden", "true");
  dockOverlay.style.setProperty("--dock-target-left", `${message.zone.rect.left}px`);
  dockOverlay.style.setProperty("--dock-target-top", `${message.zone.rect.top}px`);
  dockOverlay.style.setProperty("--dock-target-width", `${message.zone.rect.width}px`);
  dockOverlay.style.setProperty("--dock-target-height", `${message.zone.rect.height}px`);
  document.body.appendChild(dockOverlay);
  document.body.classList.add("dock-drag-active");
}

async function beginDetachedDock(payload: DockPayload): Promise<void> {
  if (!nativeDockingEnabled || observedDockSession) return;
  const message: Extract<DockProtocolMessage, { type: "dock:start" }> = {
    type: "dock:start",
    version: 2,
    sessionId: `${currentWindow.label}:${++nextDockSession}`,
    sourceWindowLabel: currentWindow.label,
    payload,
    point: await dockDragAdapter.cursor(),
  };
  observedDockSession = message;
  await emitTo(mainWindow, DOCK_PROTOCOL_EVENT, message).catch(() => { observedDockSession = null; });
}

function bindDetachedDockPointer(element: HTMLElement, payload: () => DockPayload | null): void {
  if (!nativeDockingEnabled) return;
  let armed: { pointerId: number; x: number; y: number } | null = null;
  let suppressClick = false;
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || observedDockSession) return;
    armed = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try { element.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
  });
  element.addEventListener("pointermove", (event) => {
    if (!armed || event.pointerId !== armed.pointerId
      || Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 5) return;
    const value = payload();
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    armed = null;
    if (value) {
      suppressClick = true;
      event.preventDefault();
      void beginDetachedDock(value);
    }
  });
  const clear = (event: PointerEvent): void => {
    if (armed?.pointerId !== event.pointerId) return;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    armed = null;
  };
  element.addEventListener("pointerup", clear);
  element.addEventListener("pointercancel", clear);
  element.addEventListener("click", (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}

function action(type: string, values: Record<string, unknown> = {}): Promise<void> {
  return emitTo(mainWindow, "rune:view-window-action", { windowLabel: currentWindow.label, type, ...values });
}

function request<T>(type: string, values: Record<string, unknown>): Promise<T> {
  const requestId = `${currentWindow.label}:${++nextRequest}`;
  return new Promise<T>((resolve, reject) => {
    requests.set(requestId, { resolve: (value) => resolve(value as T), reject });
    void action(type, { ...values, requestId }).catch((error) => {
      requests.delete(requestId);
      reject(error);
    });
  });
}

function applyPresentation(value: ViewWindowPresentation): void {
  document.documentElement.setAttribute("data-theme", value.theme);
  document.documentElement.style.setProperty("--ui-scale", String(value.uiScale));
  if (getLocale() !== value.locale) setLocale(value.locale);
}

function projectRequest(project: RuneProject, profile?: PublishingProfile): Record<string, unknown> {
  return { projectSource: serializeProject(project), profileId: profile?.id };
}

function render(): void {
  if (!transfer) return;
  disposePanels();
  host.replaceChildren();
  host.className = "detached-view-shell";
  const panels = new Map<WorkbenchViewId, { element: HTMLElement; refresh(): void; focus?(): void; dispose(): void }>();
  const openPath = (path: string, line?: number) => { void action("open-path", { path, line }); };
  const surfaces: Array<{
    containerId: ViewWindowTransfer["groups"][number]["containerId"];
    groupId: string;
    groupElement: HTMLElement;
    tabStrip: HTMLElement;
    tabElements: HTMLElement[];
  }> = [];
  const groupCycles = new Map<string, (direction: 1 | -1) => void>();

  const mountPanel = (viewId: WorkbenchViewId, element: HTMLElement): void => {
    if (viewId === "workspace") {
      const panel = mountFileTree(element, openPath, () => { void action("open-folder"); }, () => {}, {
        onNewFile: () => { void action("new-file"); },
        onNewFolder: () => { void action("new-folder"); },
      });
      panels.set(viewId, { element, refresh() {
        if (context.currentFolder) panel.render(context.workspaceTree, context.currentFolder);
        else panel.showNoFolder();
        panel.setActive(context.activePath);
      }, dispose: panel.dispose });
    } else if (viewId === "outline") {
      const panel = mountOutlinePanel(element, (line) => { void action("jump-line", { line }); });
      panels.set(viewId, { element, refresh() {
        panel.render(parseHeadings(context.activeMarkdown ?? ""));
        panel.setActiveLine(context.activeLine);
      }, dispose: panel.dispose });
    } else if (viewId === "tags") {
      const panel = mountTagsPanel(element, openPath);
      let lastRoot: string | null | undefined;
      panels.set(viewId, { element, refresh: () => {
        if (lastRoot !== context.currentFolder) { lastRoot = context.currentFolder; void panel.refresh(context.currentFolder); }
      }, focus: panel.focus, dispose: panel.dispose });
    } else if (viewId === "project") {
      const panel = mountProjectPanel(
        element,
        (project) => request<ProjectDiagnostic[]>("project-preflight", projectRequest(project)),
        (project, profile) => request<void>("project-preview", projectRequest(project, profile)),
        (project, profile) => request<boolean>("project-publish", projectRequest(project, profile)),
      );
      let lastProject = "";
      panels.set(viewId, { element, refresh: () => {
        const key = `${context.currentFolder ?? ""}\0${context.workspaceFiles.map((file) => file.path).join("\0")}`;
        if (lastProject !== key) { lastProject = key; void panel.refresh(context.currentFolder, context.workspaceFiles); }
      }, focus: panel.focus, dispose: panel.dispose });
    } else if (viewId === "search") {
      const panel = mountSearchPanel(element, () => context.currentFolder, () => context.activePath, openPath,
        () => context.activeMarkdown, (line) => { void action("jump-line", { line }); });
      panels.set(viewId, { element, refresh() {}, focus: panel.focus, dispose: panel.dispose });
    } else if (viewId === "backlinks") {
      const panel = mountBacklinksPanel(element, openPath);
      panels.set(viewId, { element, refresh: () => panel.render(context.backlinks), focus: panel.focus, dispose: panel.dispose });
    } else if (viewId === "properties") {
      const panel = mountPropertiesPanel(element, (markdown) => {
        if (context.activePath && context.activeMarkdown !== null) void action("replace-markdown", {
          path: context.activePath,
          baseMarkdown: context.activeMarkdown,
          markdown,
        });
      });
      panels.set(viewId, { element, refresh: () => panel.render(context.activeMarkdown), focus: panel.focus, dispose: panel.dispose });
    } else {
      const panel = mountReferencesPanel(element, openPath);
      panels.set(viewId, { element, refresh: () => panel.render(context.references), focus: panel.focus, dispose: panel.dispose });
    }
  };

  const renderGroup = (groupId: string): HTMLElement => {
    const projected = transfer!.groups.find((candidate) => candidate.group.id === groupId);
    if (!projected) throw new Error(`Detached group ${groupId} is missing`);
    const wrapper = document.createElement("section");
    wrapper.className = "detached-view-group view-group";
    wrapper.dataset.groupId = groupId;
    wrapper.dataset.containerId = projected.containerId;
    const header = document.createElement("header");
    header.className = "detached-view-header";
    const tabs = document.createElement("div");
    tabs.className = "detached-view-tabs";
    tabs.setAttribute("role", "tablist");
    const content = document.createElement("section");
    content.className = "detached-view-content";
    const groupHandle = document.createElement("button");
    groupHandle.type = "button";
    groupHandle.className = "detached-view-group-handle";
    groupHandle.textContent = "⠿";
    groupHandle.title = t("workbench.moveViewGroup");
    groupHandle.setAttribute("aria-label", groupHandle.title);
    bindDetachedDockPointer(groupHandle, () => transfer ? detachedDockPayload(transfer, groupId, "group") : null);
    const redock = document.createElement("button");
    redock.type = "button";
    redock.className = "detached-view-redock";
    redock.textContent = "↙";
    redock.title = t("workbench.moveBackToMainWindow");
    redock.setAttribute("aria-label", redock.title);
    redock.addEventListener("click", () => { void emitTo(mainWindow, "rune:view-window-redock", { windowLabel: currentWindow.label }); });
    header.append(tabs, groupHandle, redock);
    wrapper.append(header, content);

    const tabElements: HTMLButtonElement[] = [];
    const groupPanels = new Map<WorkbenchViewId, HTMLElement>();
    const activate = (viewId: WorkbenchViewId, focusPanel = true, updateWindow = true): void => {
      projected.group.activeViewId = viewId;
      if (updateWindow) {
        transfer!.activeGroupId = groupId;
        void action("active-view", { groupId, viewId });
      }
      for (const [id, element] of groupPanels) element.hidden = id !== viewId;
      for (const button of tabs.querySelectorAll<HTMLButtonElement>("button[data-view-id]")) {
        const active = button.dataset.viewId === viewId;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      if (focusPanel) panels.get(viewId)?.focus?.();
    };
    groupCycles.set(groupId, (direction) => {
      const current = projected.group.viewIds.indexOf(projected.group.activeViewId!);
      const next = (current + direction + projected.group.viewIds.length) % projected.group.viewIds.length;
      activate(projected.group.viewIds[next]);
    });
    for (const viewId of projected.group.viewIds) {
      const element = document.createElement("div");
      element.className = "detached-view-panel";
      element.id = `detached-panel-${groupId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${viewId}`;
      element.setAttribute("role", "tabpanel");
      element.hidden = true;
      content.appendChild(element);
      groupPanels.set(viewId, element);
      mountPanel(viewId, element);

      const tab = document.createElement("button");
      tab.type = "button";
      tab.dataset.viewId = viewId;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", element.id);
      tab.textContent = t(`view.${viewId}`);
      tab.addEventListener("click", () => activate(viewId));
      bindDetachedDockPointer(tab, () => transfer ? detachedDockPayload(transfer, groupId, "view", viewId) : null);
      tab.addEventListener("keydown", (event) => {
        const next = nextDetachedTabIndex(projected.group.viewIds.indexOf(viewId), projected.group.viewIds.length, event.key);
        if (next === null) return;
        event.preventDefault();
        const nextView = projected.group.viewIds[next];
        activate(nextView, false);
        tabs.querySelector<HTMLButtonElement>(`[data-view-id="${nextView}"]`)?.focus();
      });
      tabs.appendChild(tab);
      tabElements.push(tab);
    }
    surfaces.push({
      containerId: projected.containerId,
      groupId,
      groupElement: wrapper,
      tabStrip: tabs,
      tabElements,
    });
    activate(projected.group.activeViewId!, false, false);
    return wrapper;
  };

  const tree = document.createElement("div");
  tree.className = "detached-view-tree";
  tree.appendChild(renderViewGroupTree(transfer.root, renderGroup));
  host.appendChild(tree);
  cycleTab = (direction) => groupCycles.get(transfer!.activeGroupId)?.(direction);
  refreshDockSurface = () => {
    if (!transfer || !observedDockSession) return;
    void dockDragAdapter.metrics().then((metrics) => {
      const surface = measureDetachedDockTreeSurface({
        windowLabel: currentWindow.label,
        revision: dockRevision,
        metrics,
        groups: surfaces,
      });
      return emitTo(mainWindow, DOCK_PROTOCOL_EVENT, {
        type: "dock:surface",
        version: 2,
        sessionId: observedDockSession!.sessionId,
        sourceWindowLabel: currentWindow.label,
        surface,
      } satisfies DockProtocolMessage);
    }).catch((error) => console.warn(error));
  };
  refreshPanels = () => { for (const panel of panels.values()) panel.refresh(); };
  disposePanels = () => { for (const panel of panels.values()) panel.dispose(); };
  refreshPanels();
  refreshDockSurface();
}

void currentWindow.listen("rune:view-window-init", ({ payload }) => {
  if (!payload || typeof payload !== "object") return;
  const candidate = payload as { transfer?: unknown; revision?: unknown };
  const normalized = normalizeViewWindowTransfer(candidate.transfer);
  if (!normalized || normalized.targetWindowLabel !== currentWindow.label) return;
  transfer = normalized;
  if (typeof candidate.revision === "number" && Number.isInteger(candidate.revision) && candidate.revision >= 0) {
    dockRevision = candidate.revision;
  }
  applyPresentation(normalized.presentation);
  render();
  acknowledgePendingDockCommit();
});
if (nativeDockingEnabled) void currentWindow.listen(DOCK_PROTOCOL_EVENT, ({ payload }) => {
  const message = normalizeDockProtocolMessage(payload);
  if (!message) return;
  if (message.type === "dock:start") {
    if (message.sourceWindowLabel === currentWindow.label) return;
    observedDockSession = message;
    pendingDockCommit = null;
    clearDockOverlay();
    refreshDockSurface();
    return;
  }
  if (!observedDockSession || message.sessionId !== observedDockSession.sessionId) return;
  if (message.type === "dock:preview" && message.targetWindowLabel === currentWindow.label) {
    renderDockOverlay(message);
    return;
  }
  if (message.type === "dock:commit" && message.target.kind !== "new-window"
    && message.target.windowLabel === currentWindow.label) {
    pendingDockCommit = message;
    acknowledgePendingDockCommit();
    return;
  }
  if (message.type === "dock:result" || message.type === "dock:cancel") {
    observedDockSession = null;
    pendingDockCommit = null;
    clearDockOverlay();
  }
});
void currentWindow.listen<ViewWindowContext>("rune:view-window-context", ({ payload }) => {
  context = payload;
  refreshPanels();
});
void currentWindow.listen<ViewWindowPresentation>("rune:view-window-presentation", ({ payload }) => {
  const localeChanged = getLocale() !== payload.locale;
  applyPresentation(payload);
  if (localeChanged) render();
});
void currentWindow.listen<{ requestId: string; ok: boolean; value?: unknown; error?: string }>("rune:view-window-action-result", ({ payload }) => {
  const pending = requests.get(payload.requestId);
  if (!pending) return;
  requests.delete(payload.requestId);
  if (payload.ok) pending.resolve(payload.value);
  else pending.reject(new Error(payload.error ?? "Detached View action failed"));
});
void getCurrentWebview().onDragDropEvent(({ payload }) => {
  if (payload.type !== "drop") return;
  const path = firstMarkdownPath(payload.paths);
  if (path) void action("open-path", { path });
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && observedDockSession?.sourceWindowLabel === currentWindow.label) {
    const session = observedDockSession;
    observedDockSession = null;
    pendingDockCommit = null;
    clearDockOverlay();
    void emitTo(mainWindow, DOCK_PROTOCOL_EVENT, {
      type: "dock:cancel",
      version: 2,
      sessionId: session.sessionId,
      sourceWindowLabel: currentWindow.label,
      reason: "escape",
    } satisfies DockProtocolMessage);
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Tab") {
    event.preventDefault();
    cycleTab(event.shiftKey ? -1 : 1);
  }
});
window.addEventListener("resize", () => refreshDockSurface());
void emitTo(mainWindow, "rune:view-window-ready", { windowLabel: currentWindow.label });
