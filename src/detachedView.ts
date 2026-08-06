import "./styles.css";
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
import type { WorkbenchViewId } from "./workbench/workbenchLayout";
import type { ViewWindowContext } from "./workbench/viewWindowHost";
import { normalizeViewWindowTransfer, type ViewWindowPresentation, type ViewWindowTransfer } from "./workbench/viewWindowTransfer";

const currentWindow = getCurrentWebviewWindow();
const mainWindow = "main";
const host = document.getElementById("detached-view")!;
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
  const header = document.createElement("header");
  header.className = "detached-view-header";
  const tabs = document.createElement("div");
  tabs.className = "detached-view-tabs";
  tabs.setAttribute("role", "tablist");
  const content = document.createElement("section");
  content.className = "detached-view-content";
  const redock = document.createElement("button");
  redock.type = "button";
  redock.className = "detached-view-redock";
  redock.textContent = "↙";
  redock.title = "Move View Group Back to Main Window";
  redock.setAttribute("aria-label", redock.title);
  redock.addEventListener("click", () => { void emitTo(mainWindow, "rune:view-window-redock", { windowLabel: currentWindow.label }); });
  header.append(tabs, redock);
  host.append(header, content);

  const panels = new Map<WorkbenchViewId, { element: HTMLElement; refresh(): void; focus?(): void; dispose(): void }>();
  const openPath = (path: string, line?: number) => { void action("open-path", { path, line }); };
  const elements = new Map<WorkbenchViewId, HTMLElement>();
  for (const viewId of transfer.group.viewIds) {
    const element = document.createElement("div");
    element.className = "detached-view-panel";
    element.hidden = true;
    content.appendChild(element);
    elements.set(viewId, element);

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
  }

  const activate = (viewId: WorkbenchViewId): void => {
    transfer!.group.activeViewId = viewId;
    for (const [id, panel] of panels) panel.element.hidden = id !== viewId;
    for (const button of tabs.querySelectorAll<HTMLButtonElement>("button[data-view-id]")) {
      const active = button.dataset.viewId === viewId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    panels.get(viewId)?.focus?.();
  };
  cycleTab = (direction) => {
    const current = transfer!.group.viewIds.indexOf(transfer!.group.activeViewId!);
    const next = (current + direction + transfer!.group.viewIds.length) % transfer!.group.viewIds.length;
    activate(transfer!.group.viewIds[next]);
  };
  for (const viewId of transfer.group.viewIds) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.viewId = viewId;
    tab.setAttribute("role", "tab");
    tab.textContent = t(`view.${viewId}`);
    tab.addEventListener("click", () => activate(viewId));
    tabs.appendChild(tab);
  }
  refreshPanels = () => { for (const panel of panels.values()) panel.refresh(); };
  disposePanels = () => { for (const panel of panels.values()) panel.dispose(); };
  refreshPanels();
  activate(transfer.group.activeViewId!);
}

void currentWindow.listen("rune:view-window-init", ({ payload }) => {
  if (!payload || typeof payload !== "object") return;
  const candidate = payload as { transfer?: unknown; context?: ViewWindowContext };
  const normalized = normalizeViewWindowTransfer(candidate.transfer);
  if (!normalized || normalized.targetWindowLabel !== currentWindow.label || !candidate.context) return;
  transfer = normalized;
  context = candidate.context;
  applyPresentation(normalized.presentation);
  render();
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
  if ((event.ctrlKey || event.metaKey) && event.key === "Tab") {
    event.preventDefault();
    cycleTab(event.shiftKey ? -1 : 1);
  }
});
void emitTo(mainWindow, "rune:view-window-ready", { windowLabel: currentWindow.label });
