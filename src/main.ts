import "./styles.css";
if (import.meta.env.VITE_WDIO === "1") void import("@wdio/tauri-plugin");
if (import.meta.env.VITE_WDIO === "1") {
  void import("./workbench/tauriDockDragAdapter").then((dockDrag) => {
    Object.assign(window, {
      __RUNE_NATIVE_DOCK_DRAG__: {
        adapter: dockDrag.createTauriDockDragAdapter(),
        logicalClientPointToPhysicalScreen: dockDrag.logicalClientPointToPhysicalScreen,
      },
    });
    document.documentElement.dataset.wdioNativeDockDragReady = "true";
  });
}
import { type EditorMode } from "./editor/editor";
import { commands, type FileNode, type LinkTarget, type PathChangePlan } from "./ipc/bindings";
import { confirm as confirmDialog, open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { mountUpdateBanner } from "./workspace/updatePanel";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { mountChrome } from "./chrome/chrome";
import { mountFileTree, type FileTree } from "./workspace/fileTree";
import { parentDir } from "./workspace/paths";
import { listen, type Event } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { mountConflictBanner } from "./workspace/conflictBanner";
import { mountErrorBanner } from "./workspace/errorBanner";
import {
  collectWorkspaceHeadings,
  headingPaletteItems,
  mountCommandPalette,
  workspaceHeadingPaletteItems,
  type PaletteItem,
  type WorkspaceHeading,
} from "./workspace/commandPalette";
import { exportHtml, exportPdf, printHtmlDocument, showHtmlPreview } from "./export/exportDoc";
import { mountSearchPanel } from "./workspace/searchPanel";
import { mountFindReplacePanel, type FindReplacePanel } from "./workspace/findReplacePanel";
import { mountSettingsPanel } from "./workspace/settingsPanel";
import { mountLayoutModeControl, normalizeEditorMode, type LayoutModeControl } from "./workspace/layoutModeControl";
import { parseHeadings } from "./editor/outline";
import { mountOutlinePanel, type OutlinePanel } from "./workspace/outlinePanel";
import { showLanguagePicker } from "./workspace/languagePicker";
import { mountHelpPanel } from "./workspace/helpPanel";
import { t as tr, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n/i18n";
import { menuLabels } from "./chrome/menuLabels";
import { showContextMenu, type MenuItem } from "./workspace/contextMenu";
import { promptModal } from "./workspace/promptModal";
import { runPathChange } from "./workspace/pathChangeFlow";
import { showPathChangePreview } from "./workspace/pathChangePreview";
import { clearFindHighlights, findHighlightExtension, setFindHighlights } from "./editor/findHighlights";
import { createSettingsSaveScheduler, DEFAULT_LAYOUT, normalizeLayoutSettings, normalizePersistedWorkbenchLayout, parseLayoutSettingsJson, serializeLayoutSettings, type LayoutSettings, type ResolvedLayoutSettings } from "./workspace/layoutSettings";
import { clampEditorFontScale, stepEditorFontScale, EDITOR_FONT_DEFAULT, clampUiScale, UI_SCALE_DEFAULT } from "./theme/scale";
import { createPaneWorkspace, type PaneWorkspace } from "./workspace/paneWorkspace";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { normalizePaneWorkspaceSnapshot } from "./workspace/panePersistence";
import { parseHotExitSnapshot } from "./workspace/hotExit";
import { createHotExitStore } from "./workspace/hotExitStore";
import { dropZoneRect, firstMarkdownPath, hitPaneDropZone, physicalToCssPoint } from "./workspace/dropTargets";
import { createNativeFileOpenQueue, handleNativeFileDrop, type ResolvedDropTarget } from "./workspace/fileDrop";
import { createViewRegistry } from "./workbench/viewRegistry";
import { createCommandRegistry } from "./workbench/commandRegistry";
import { mountWorkbench } from "./workbench/workbench";
import { createTauriDockDragAdapter, logicalClientPointToPhysicalScreen } from "./workbench/tauriDockDragAdapter";
import { createViewWindowHost } from "./workbench/viewWindowHost";
import { tauriViewWindowAdapter } from "./workbench/tauriViewWindowAdapter";
import type { DockProtocolMessage } from "./workbench/viewWindowTransfer";
import { viewGroupIdForView } from "./workbench/viewGroupLayout";
import { EMPTY_VIEW_WINDOW_LAYOUT, normalizeViewWindowLayout } from "./workbench/viewWindowLayout";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  type WorkbenchContainerId,
  type WorkbenchPartId,
  type WorkbenchViewId,
} from "./workbench/workbenchLayout";
import {
  captureNamedLayout,
  deleteSavedLayout,
  namedLayoutChoices,
  normalizeSavedLayouts,
  resolveNamedLayout,
  upsertSavedLayout,
  type NamedLayoutChoice,
  type SavedNamedLayout,
} from "./workspace/namedLayouts";
import { writingModesExtension } from "./editor/writingModes";
import { markdownLinkExtensions, refreshMarkdownLinkDiagnostics } from "./editor/markdownLinks";
import { citationCompletionSource, citationLintExtension } from "./editor/citations";
import { mountBacklinksPanel, type BacklinksPanel, type BacklinksPanelState } from "./workspace/backlinksPanel";
import { mountPropertiesPanel, type PropertiesPanel } from "./workspace/propertiesPanel";
import { mountTagsPanel, type TagsPanel } from "./workspace/tagsPanel";
import { mountProjectPanel, projectManifestPath, projectRelativePath, type ProjectPanel } from "./workspace/projectPanel";
import {
  buildReferenceItems,
  mountReferencesPanel,
  type ReferencesPanel,
  type ReferencesPanelState,
} from "./workspace/referencesPanel";
import {
  buildProjectPublication,
  materializeProjectHtml,
  materializeProjectHtmlForOutput,
  projectOutputPath,
  type ProjectDocument,
  type ProjectPublication,
} from "./project/projectExport";
import { parseProject, type PublishingProfile, type RuneProject } from "./project/project";
import { preflightProject, type ProjectDiagnostic } from "./project/projectPreflight";
import { loadProjectManifest } from "./project/projectManifest";
import {
  mergeCitationLibraries,
  parseBibTeX,
  projectResourceAbsolutePath,
  type CitationLibrary,
} from "./project/citations";

const commandRegistry = createCommandRegistry();
const togglePartCommandId = (id: WorkbenchPartId): string => `workbench.part.toggle.${id}`;
const openViewCommandId = (id: WorkbenchViewId): string => `workbench.view.open.${id}`;
const closeViewCommandId = (id: WorkbenchViewId): string => `workbench.view.close.${id}`;
const toggleViewCommandId = (id: WorkbenchViewId): string => `workbench.view.toggle.${id}`;
const moveViewCommandId = (id: WorkbenchViewId, containerId: WorkbenchContainerId): string =>
  `workbench.view.move.${id}.${containerId}`;

const chrome = mountChrome(document.getElementById("titlebar")!, document.getElementById("statusbar")!, {
  onTogglePrimarySidebar: () => commandRegistry.execute(togglePartCommandId("primarySidebar")),
  onToggleSecondarySidebar: () => commandRegistry.execute(togglePartCommandId("secondarySidebar")),
  onTogglePanel: () => commandRegistry.execute(togglePartCommandId("panel")),
  onOpenSettings: () => settingsPanel.open(),
});
const editorRoot = document.getElementById("editor")!;
const editorToolbar = document.getElementById("editor-toolbar")!;
const dropOverlay = document.createElement("div");
dropOverlay.className = "drop-overlay hidden";
document.body.appendChild(dropOverlay);

let paneWorkspace: PaneWorkspace;
let currentFolder: string | null = null;
let workspaceTree: FileNode[] = [];
let workspaceFiles: { name: string; path: string }[] = [];
let workspaceHeadings: WorkspaceHeading[] = [];
let workspaceHeadingLoad = 0;
const workspaceLinkTargets = new Map<string, LinkTarget[]>();
const workspaceLinkTargetLoads = new Map<string, Promise<void>>();
let workspaceLinkTargetVersion = 0;
let editorMode: EditorMode = "preview";
let findReplacePanel: FindReplacePanel | null = null;
let layoutModeControl: LayoutModeControl | null = null;
let namedLayouts: SavedNamedLayout[] = [];
let activeNamedLayout: string | null = null;
let focusMode = false;
let typewriterMode = false;
let focusLayout = false;
let tree: FileTree;
let outlinePanel: OutlinePanel;
let backlinksPanel: BacklinksPanel | null = null;
let backlinksState: BacklinksPanelState = "noDocument";
let backlinksLoad = 0;
let propertiesPanel: PropertiesPanel | null = null;
let tagsPanel: TagsPanel | null = null;
let projectPanel: ProjectPanel | null = null;
let referencesPanel: ReferencesPanel | null = null;
let referencesState: ReferencesPanelState = "noProject";
let referencesLoad = 0;
let referencesTimer: number | undefined;
let citationProject: RuneProject | null = null;
let citationLibrary: CitationLibrary = { entries: [], duplicates: [] };
let citationLoad = 0;
let viewWindowHost: ReturnType<typeof createViewWindowHost> | null = null;

const viewRegistry = createViewRegistry();
viewRegistry.registerContainer({ id: "explorer", titleKey: "view.explorer", icon: "▤", order: 0 });
viewRegistry.registerContainer({ id: "search", titleKey: "view.search", icon: "⌕", order: 1 });
viewRegistry.registerContainer({ id: "auxiliary", titleKey: "view.auxiliary", icon: "◧", order: 0 });
viewRegistry.registerContainer({ id: "panel", titleKey: "view.panel", icon: "⌄", order: 0 });
viewRegistry.registerView({
  id: "workspace",
  titleKey: "view.workspace",
  defaultContainerId: "explorer",
  order: 0,
  create() {
    const element = document.createElement("div");
    tree = mountFileTree(element, (path) => void openPath(path), () => void openFolder(), fileTreeMenu, {
      onNewFile: () => { if (currentFolder) void newFileIn(currentFolder); },
      onNewFolder: () => { if (currentFolder) void newFolderIn(currentFolder); },
    });
    return {
      element,
      relabel: () => tree.relabel(),
      dispose: () => tree.dispose(),
    };
  },
});
viewRegistry.registerView({
  id: "outline",
  titleKey: "view.outline",
  defaultContainerId: "explorer",
  order: 1,
  create() {
    const element = document.createElement("div");
    outlinePanel = mountOutlinePanel(element, jumpToLine);
    return {
      element,
      relabel: () => outlinePanel.relabel(),
      dispose: () => outlinePanel.dispose(),
    };
  },
});
viewRegistry.registerView({
  id: "tags",
  titleKey: "view.tags",
  defaultContainerId: "explorer",
  order: 2,
  create() {
    const element = document.createElement("div");
    tagsPanel = mountTagsPanel(element, (path) => void openPath(path));
    void tagsPanel.refresh(currentFolder);
    return {
      element,
      focus: () => tagsPanel?.focus(),
      relabel: () => tagsPanel?.relabel(),
      dispose: () => {
        tagsPanel?.dispose();
        tagsPanel = null;
      },
    };
  },
});
viewRegistry.registerView({
  id: "project",
  titleKey: "view.project",
  defaultContainerId: "explorer",
  order: 3,
  create() {
    const element = document.createElement("div");
    projectPanel = mountProjectPanel(element, preflightCurrentProject, previewProject, publishProject);
    void projectPanel.refresh(currentFolder, workspaceFiles);
    return {
      element,
      focus: () => projectPanel?.focus(),
      relabel: () => projectPanel?.relabel(),
      dispose: () => {
        projectPanel?.dispose();
        projectPanel = null;
      },
    };
  },
});
viewRegistry.registerView({
  id: "search",
  titleKey: "view.search",
  defaultContainerId: "search",
  order: 0,
  create() {
    const element = document.createElement("div");
    const panel = mountSearchPanel(
      element,
      () => currentFolder,
      () => typeof paneWorkspace === "undefined" ? null : activePane().activePath(),
      (path, line) => { void (async () => { if (await openPath(path)) jumpToLine(line); })(); },
      () => typeof paneWorkspace === "undefined" ? null : activeView().state.doc.toString(),
      jumpToLine,
    );
    return {
      element,
      focus: () => panel.focus(),
      relabel: () => panel.relabel(),
      dispose: () => panel.dispose(),
    };
  },
});
viewRegistry.registerView({
  id: "backlinks",
  titleKey: "view.backlinks",
  defaultContainerId: "auxiliary",
  order: 0,
  create() {
    const element = document.createElement("div");
    backlinksPanel = mountBacklinksPanel(element, (path, line) => {
      void (async () => { if (await openPath(path)) jumpToLine(line); })();
    });
    void refreshBacklinks();
    return {
      element,
      focus: () => backlinksPanel?.focus(),
      relabel: () => backlinksPanel?.relabel(),
      dispose: () => {
        backlinksPanel?.dispose();
        backlinksPanel = null;
      },
    };
  },
});
viewRegistry.registerView({
  id: "properties",
  titleKey: "view.properties",
  defaultContainerId: "auxiliary",
  order: 1,
  create() {
    const element = document.createElement("div");
    propertiesPanel = mountPropertiesPanel(element, (markdown) => {
      const view = activeView();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } });
    });
    refreshProperties();
    return {
      element,
      focus: () => propertiesPanel?.focus(),
      relabel: () => propertiesPanel?.relabel(),
      dispose: () => {
        propertiesPanel?.dispose();
        propertiesPanel = null;
      },
    };
  },
});
viewRegistry.registerView({
  id: "references",
  titleKey: "view.references",
  defaultContainerId: "auxiliary",
  order: 2,
  create() {
    const element = document.createElement("div");
    referencesPanel = mountReferencesPanel(element, (path, line) => {
      const root = currentFolder;
      if (root) void (async () => { if (await openPath(projectResourceAbsolutePath(root, path))) jumpToLine(line); })();
    });
    void refreshReferences();
    return {
      element,
      focus: () => referencesPanel?.focus(),
      relabel: () => referencesPanel?.relabel(),
      dispose: () => {
        referencesLoad++;
        referencesPanel?.dispose();
        referencesPanel = null;
      },
    };
  },
});
viewRegistry.resolveView("workspace");
viewRegistry.resolveView("outline");
const nativeDockDrag = import.meta.env.VITE_NATIVE_DOCKING === "1" ? createTauriDockDragAdapter() : null;
const workbench = mountWorkbench({
  activityBar: document.getElementById("activitybar")!,
  primarySidebar: document.getElementById("primary-sidebar")!,
  primaryResizer: document.getElementById("primary-sidebar-resizer")!,
  secondarySidebar: document.getElementById("secondary-sidebar")!,
  secondaryResizer: document.getElementById("secondary-sidebar-resizer")!,
  panel: document.getElementById("panel")!,
  panelResizer: document.getElementById("panel-resizer")!,
  registry: viewRegistry,
  initialState: DEFAULT_WORKBENCH_LAYOUT,
  focusEditor: () => { if (typeof paneWorkspace !== "undefined") activeView().focus(); },
  nativeDocking: nativeDockDrag ? {
    metrics: nativeDockDrag.metrics,
    workspace: () => ({
      viewWindows: viewWindowHost?.layoutSnapshot() ?? EMPTY_VIEW_WINDOW_LAYOUT,
      windowLabels: viewWindowHost?.detachedWindows() ?? [],
    }),
    requestNewWindow: async (payload, point) => {
      if (!viewWindowHost) throw new Error("Native View window host is not ready");
      await viewWindowHost.tearOffPayload(payload, point);
    },
  } : undefined,
  onViewMenu: (id, x, y) => {
    const snapshot = workbench.snapshot();
    const current = snapshot.views[id].containerId;
    const groupId = viewGroupIdForView(snapshot.viewGroups[current], id);
    const destinations = [
      ["explorer", "workbench.moveToPrimarySidebar"],
      ["auxiliary", "workbench.moveToSecondarySidebar"],
      ["panel", "workbench.moveToPanel"],
    ] as const;
    showContextMenu(x, y, [
      ...(viewWindowHost && groupId ? [{
        label: tr("workbench.moveToNewWindow"),
        run: () => { void viewWindowHost!.tearOff(current, groupId).catch((error) => {
          console.error(error);
          errorBanner.show(error instanceof Error ? error.message : String(error));
        }); },
      }] : []),
      ...destinations
        .filter(([containerId]) => containerId !== current)
        .map(([containerId, label]) => ({ label: tr(label), run: () => commandRegistry.execute(moveViewCommandId(id, containerId)) })),
      { label: tr("view.close"), run: () => commandRegistry.execute(closeViewCommandId(id)) },
    ]);
  },
});
workbench.onDidChange(() => {
  viewWindowHost?.reconcileLayout();
  activeNamedLayout = null;
  scheduleSaveSettings();
});

if (isTauri()) {
  viewWindowHost = createViewWindowHost({
    adapter: tauriViewWindowAdapter,
    sourceWindowLabel: "main",
    snapshot: () => workbench.snapshot(),
    dockSnapshot: () => workbench.dockWorkspaceSnapshot(
      viewWindowHost?.layoutSnapshot() ?? EMPTY_VIEW_WINDOW_LAYOUT,
      viewWindowHost?.detachedWindows() ?? [],
    ),
    commitDockSnapshot: (snapshot) => workbench.commitDockWorkspaceSnapshot(snapshot),
    ...(nativeDockDrag ? {
      dockSurfaces: async () => {
        const workspace = workbench.dockWorkspaceSnapshot(
          viewWindowHost?.layoutSnapshot() ?? EMPTY_VIEW_WINDOW_LAYOUT,
          viewWindowHost?.detachedWindows() ?? [],
        );
        return [workbench.dockSurface(await nativeDockDrag.metrics(), workspace.revision)];
      },
      renderMainDockPreview: (message: Extract<DockProtocolMessage, { type: "dock:preview" }> | null) => workbench.showDockPreview(message ? {
        payload: message.payload,
        zone: message.zone,
        point: message.point,
      } : null),
    } : {}),
    setViewGroupDetached: (containerId, groupId, detached) => workbench.setViewGroupDetached(containerId, groupId, detached),
    presentation: () => ({ theme: currentTheme(), uiScale: currentUiScale(), locale: getLocale() }),
    context: viewWindowContext,
    onAction: handleViewWindowAction,
    onLayoutChange: scheduleSaveSettings,
  });
  void viewWindowHost.start().catch((error) => console.warn(error));
}

if (import.meta.env.VITE_WDIO === "1" && nativeDockDrag) {
  Object.assign(window, {
    __RUNE_DOCKING_RELEASE_GATE__: {
      metrics: nativeDockDrag.metrics,
      focus: () => getCurrentWebviewWindow().setFocus(),
      normalizeWindow: async () => {
        const window = getCurrentWebviewWindow();
        await window.setSize(new PhysicalSize(800, 600));
        await window.setPosition(new PhysicalPosition(40, 40));
        await window.setFocus();
      },
      toPhysical: logicalClientPointToPhysicalScreen,
      workspace: () => structuredClone(workbench.dockWorkspaceSnapshot(
        viewWindowHost?.layoutSnapshot() ?? EMPTY_VIEW_WINDOW_LAYOUT,
        viewWindowHost?.detachedWindows() ?? [],
      )),
      serializedLayout: () => JSON.stringify(viewWindowHost?.layoutSnapshot() ?? EMPTY_VIEW_WINDOW_LAYOUT),
      preparePanel: () => {
        workbench.openView("search");
        workbench.moveView("search", "panel", 0);
      },
    },
  });
  document.documentElement.dataset.wdioDockingReleaseGateReady = "true";
}

const viewDestinations = [
  ["explorer", "workbench.moveToPrimarySidebar"],
  ["auxiliary", "workbench.moveToSecondarySidebar"],
  ["panel", "workbench.moveToPanel"],
] as const;

commandRegistry.register({
  id: togglePartCommandId("primarySidebar"),
  title: () => tr("workbench.togglePrimarySidebar"),
  run: () => workbench.togglePrimarySidebar(),
});
for (const partId of ["secondarySidebar", "panel"] as const) {
  commandRegistry.register({
    id: togglePartCommandId(partId),
    title: () => tr(partId === "secondarySidebar" ? "workbench.toggleSecondarySidebar" : "workbench.togglePanel"),
    run: () => workbench.togglePart(partId),
  });
}
commandRegistry.register({ id: "workbench.primarySidebar.left", title: () => tr("workbench.movePrimarySidebarLeft"), run: () => workbench.setPrimarySidebarPosition("left") });
commandRegistry.register({ id: "workbench.primarySidebar.right", title: () => tr("workbench.movePrimarySidebarRight"), run: () => workbench.setPrimarySidebarPosition("right") });
commandRegistry.register({ id: "workbench.panel.bottom", title: () => tr("workbench.movePanelBottom"), run: () => workbench.setPanelPosition("bottom") });
commandRegistry.register({ id: "workbench.panel.left", title: () => tr("workbench.movePanelLeft"), run: () => workbench.setPanelPosition("left") });
commandRegistry.register({ id: "workbench.panel.right", title: () => tr("workbench.movePanelRight"), run: () => workbench.setPanelPosition("right") });
commandRegistry.register({ id: "workbench.views.resetLocations", title: () => tr("workbench.resetViewLocations"), run: () => workbench.resetViewLocations() });
commandRegistry.register({ id: "workbench.views.resetVisibility", title: () => tr("workbench.resetViewVisibility"), run: () => workbench.resetViewVisibility() });
commandRegistry.register({ id: toggleViewCommandId("search"), title: () => tr("cmd.search"), run: () => workbench.toggleView("search") });
for (const view of viewRegistry.allViews()) {
  commandRegistry.register({
    id: openViewCommandId(view.id),
    title: () => tr(view.titleKey),
    run: () => workbench.openView(view.id),
  });
  commandRegistry.register({
    id: closeViewCommandId(view.id),
    title: () => `${tr("view.close")} ${tr(view.titleKey)}`,
    run: () => workbench.closeView(view.id),
    palette: false,
  });
  for (const [containerId, titleKey] of viewDestinations) {
    commandRegistry.register({
      id: moveViewCommandId(view.id, containerId),
      title: () => `${tr("workbench.moveView")}: ${tr(view.titleKey)} — ${tr(titleKey)}`,
      run: () => workbench.moveView(view.id, containerId),
    });
  }
}

const SPLIT_RATIO_DEFAULT = DEFAULT_LAYOUT.splitRatio;
const SPLIT_RATIO_MIN = 0.12;
const SPLIT_RATIO_MAX = 0.88;

function prefersDark(): boolean { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
function activePane() { return paneWorkspace.activePane(); }
function activeView(): EditorView { return activePane().view; }
function settingsSnapshot() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const workbenchLayout = workbench.snapshot();
  const layout = {
    sidebarWidth: workbenchLayout.parts.primarySidebar.size,
    outlineHeight: workbenchLayout.views.outline.size ?? DEFAULT_LAYOUT.outlineHeight,
    splitRatio: currentSplitRatio(),
  };
  const paneLayout = typeof paneWorkspace === "undefined" ? null : paneWorkspace.snapshot();
  const openTabs = paneLayout?.panes.flatMap((pane) => pane.openTabs) ?? [];
  return { theme, lastFolder: currentFolder, openTabs, locale: getLocale(), editorWidth: currentEditorWidth(), editorMode, sidebarWidth: layout.sidebarWidth, layout, workbenchLayout, viewWindowLayout: viewWindowHost?.layoutSnapshot() ?? null, namedLayouts, activeNamedLayout, focusMode, typewriterMode, paneLayout, uiScale: currentUiScale(), editorFontScale: currentEditorFontScale() };
}
function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  broadcastViewWindowPresentation();
  scheduleSaveSettings();
}
function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function currentEditorWidth(): "readable" | "wide" {
  return document.documentElement.getAttribute("data-editor-width") === "wide" ? "wide" : "readable";
}
function applyEditorWidth(w: "readable" | "wide", persist = true): void {
  document.documentElement.setAttribute("data-editor-width", w);
  if (persist) { activeNamedLayout = null; scheduleSaveSettings(); }
}
function flipEditorWidth(): void {
  applyEditorWidth(currentEditorWidth() === "wide" ? "readable" : "wide");
}
function currentEditorMode(): EditorMode {
  return editorMode;
}
function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}
function currentSplitRatio(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--split-source-width").trim();
  if (raw.endsWith("%")) return clampRatio(Number.parseFloat(raw) / 100);
  return SPLIT_RATIO_DEFAULT;
}
function currentLayoutSettings(): ResolvedLayoutSettings {
  const workbenchLayout = workbench.snapshot();
  return {
    sidebarWidth: workbenchLayout.parts.primarySidebar.size,
    outlineHeight: workbenchLayout.views.outline.size ?? DEFAULT_LAYOUT.outlineHeight,
    splitRatio: currentSplitRatio(),
  };
}
function applySplitRatio(ratio: number, persist = true): void {
  const clamped = clampRatio(ratio);
  document.documentElement.style.setProperty("--split-source-width", `${Math.round(clamped * 1000) / 10}%`);
  if (typeof paneWorkspace !== "undefined") paneWorkspace.setSplitRatio(clamped);
  if (persist) { activeNamedLayout = null; scheduleSaveSettings(); }
}
function applyLayoutSettings(layout: Partial<LayoutSettings>, persist = true): void {
  const normalized = normalizeLayoutSettings(layout);
  const workbenchLayout = workbench.snapshot();
  workbenchLayout.parts.primarySidebar.size = normalized.sidebarWidth;
  workbenchLayout.views.outline.size = normalized.outlineHeight;
  workbench.restore(workbenchLayout);
  applySplitRatio(normalized.splitRatio, false);
  if (persist) scheduleSaveSettings();
}
function resetLayoutSettings(): void {
  applyLayoutSettings(DEFAULT_LAYOUT, false);
  workbench.restore(DEFAULT_WORKBENCH_LAYOUT);
  scheduleSaveSettings();
  settingsPanel.refresh();
}
function importLayoutSettings(text: string): boolean {
  const parsed = parseLayoutSettingsJson(text);
  if (!parsed) return false;
  applyLayoutSettings(parsed.layout, false);
  if (parsed.workbench) workbench.restore(parsed.workbench);
  scheduleSaveSettings();
  settingsPanel.refresh();
  return true;
}
function exportLayoutSettings(): string {
  return serializeLayoutSettings(currentLayoutSettings(), workbench.snapshot());
}
function layoutSummary(): string {
  const layout = currentLayoutSettings();
  return `${layout.sidebarWidth}px / ${layout.outlineHeight}px / ${Math.round(layout.splitRatio * 100)}%`;
}
function currentNamedLayoutState() {
  return {
    workbenchLayout: workbench.snapshot(),
    layout: currentLayoutSettings(),
    editorWidth: currentEditorWidth(),
    editorMode: currentEditorMode(),
    paneLayout: paneWorkspace.snapshot(),
  };
}
function namedLayoutLabel(choice: NamedLayoutChoice): string {
  return choice.builtIn ? tr(`layout.builtIn.${choice.name}`) : choice.name;
}
async function loadNamedLayout(value: string): Promise<boolean> {
  const layout = resolveNamedLayout(value, namedLayouts);
  if (!layout) return false;
  if (layout.paneLayout) {
    await paneWorkspace.flushSaves();
    if (paneWorkspace.hasDirtyTabs() && !(await confirmDialog(tr("layout.restoreTabsConfirm"), { title: "Rune", kind: "warning" }))) return false;
  }
  workbench.restore(layout.workbenchLayout);
  applySplitRatio(layout.layout.splitRatio, false);
  applyEditorWidth(layout.editorWidth, false);
  applyEditorMode(layout.editorMode, false);
  if (layout.paneLayout) await paneWorkspace.restore(layout.paneLayout);
  activeNamedLayout = value;
  syncActiveUI();
  saveSettingsNow();
  return true;
}
async function saveNamedLayout(includeTabs: boolean): Promise<boolean> {
  const name = await promptModal({ title: tr("layout.namePrompt") });
  if (!name) return false;
  const existing = namedLayouts.find((layout) => layout.name.toLowerCase() === name.toLowerCase());
  if (existing && !(await confirmDialog(tr("layout.overwriteConfirm", { name: existing.name }), { title: "Rune", kind: "warning" }))) return false;
  const saved = captureNamedLayout(name, currentNamedLayoutState(), includeTabs);
  if (!saved) return false;
  namedLayouts = upsertSavedLayout(namedLayouts, saved);
  activeNamedLayout = `saved:${saved.name}`;
  saveSettingsNow();
  return true;
}
async function deleteNamedLayout(value: string): Promise<boolean> {
  if (!value.startsWith("saved:")) return false;
  const name = value.slice("saved:".length);
  if (!namedLayouts.some((layout) => layout.name === name)) return false;
  if (!(await confirmDialog(tr("layout.deleteConfirm", { name }), { title: "Rune", kind: "warning" }))) return false;
  namedLayouts = deleteSavedLayout(namedLayouts, name);
  if (activeNamedLayout === value) activeNamedLayout = null;
  saveSettingsNow();
  return true;
}
function applyEditorMode(mode: EditorMode, persist = true): void {
  if (editorMode === mode) return;
  if (persist) activeNamedLayout = null;
  editorMode = mode;
  document.documentElement.setAttribute("data-editor-mode", mode);
  if (typeof paneWorkspace !== "undefined") paneWorkspace.setEditorMode(mode);
  syncActiveUI();
  layoutModeControl?.setMode(editorMode);
  settingsPanel.refresh();
  if (persist) scheduleSaveSettings();
}
function flipEditorMode(): void {
  applyEditorMode(currentEditorMode() === "preview" ? "source" : "preview");
}
function applyFocusMode(enabled: boolean, persist = true): void {
  focusMode = enabled;
  document.documentElement.setAttribute("data-focus-mode", String(enabled));
  if (typeof paneWorkspace !== "undefined") paneWorkspace.refreshWritingModes();
  if (persist) scheduleSaveSettings();
}
function applyTypewriterMode(enabled: boolean, persist = true): void {
  typewriterMode = enabled;
  document.documentElement.setAttribute("data-typewriter-mode", String(enabled));
  if (typeof paneWorkspace !== "undefined") paneWorkspace.refreshWritingModes();
  if (persist) scheduleSaveSettings();
}
function applyFocusLayout(enabled: boolean): void {
  focusLayout = enabled;
  document.documentElement.setAttribute("data-focus-layout", String(enabled));
  if (typeof paneWorkspace !== "undefined") activeView().requestMeasure();
}
function applyEditorFontScale(scale: number, persist = true): void {
  document.documentElement.style.setProperty("--editor-font-scale", String(clampEditorFontScale(scale)));
  if (persist) scheduleSaveSettings();
}
function currentEditorFontScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--editor-font-scale");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampEditorFontScale(parsed) : EDITOR_FONT_DEFAULT;
}
function applyUiScale(scale: number, persist = true): void {
  document.documentElement.style.setProperty("--ui-scale", String(clampUiScale(scale)));
  workbench.reflow({ emitChange: persist });
  broadcastViewWindowPresentation();
  if (persist) scheduleSaveSettings();
}
function currentUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampUiScale(parsed) : UI_SCALE_DEFAULT;
}
function viewWindowContext() {
  const ready = typeof paneWorkspace !== "undefined";
  const view = ready ? activeView() : null;
  return {
    currentFolder,
    activePath: ready ? activePane().activePath() : null,
    activeMarkdown: view ? view.state.doc.toString() : null,
    activeLine: view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1,
    workspaceTree,
    workspaceFiles,
    backlinks: backlinksState,
    references: referencesState,
  };
}
function broadcastViewWindowContext(): void {
  void viewWindowHost?.broadcastContext().catch((error) => console.warn(error));
}
function broadcastViewWindowPresentation(): void {
  void viewWindowHost?.broadcastPresentation().catch((error) => console.warn(error));
}
function actionRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid detached View action");
  return value as Record<string, unknown>;
}
async function handleViewWindowAction(payload: unknown): Promise<unknown> {
  const action = actionRecord(payload);
  if (typeof action.type !== "string") throw new Error("Invalid detached View action type");
  await getCurrentWebviewWindow().setFocus();
  if (action.type === "open-folder") return openFolder();
  if (action.type === "new-file") return currentFolder ? newFileIn(currentFolder) : undefined;
  if (action.type === "new-folder") return currentFolder ? newFolderIn(currentFolder) : undefined;
  if (action.type === "jump-line") {
    if (typeof action.line !== "number" || !Number.isInteger(action.line) || action.line < 1) throw new Error("Invalid line");
    jumpToLine(action.line);
    return;
  }
  if (action.type === "open-path") {
    if (typeof action.path !== "string" || !action.path) throw new Error("Invalid path");
    if (await openPath(action.path) && typeof action.line === "number" && Number.isInteger(action.line) && action.line > 0) jumpToLine(action.line);
    return;
  }
  if (action.type === "replace-markdown") {
    if (typeof action.path !== "string" || typeof action.baseMarkdown !== "string" || typeof action.markdown !== "string"
      || !samePath(activePane().activePath() ?? "", action.path)
      || activeView().state.doc.toString() !== action.baseMarkdown) throw new Error("Document changed before Properties update");
    activeView().dispatch({ changes: { from: 0, to: activeView().state.doc.length, insert: action.markdown } });
    syncActiveUI();
    return;
  }
  if (action.type === "project-preflight" || action.type === "project-preview" || action.type === "project-publish") {
    if (typeof action.projectSource !== "string") throw new Error("Invalid project");
    const project = parseProject(action.projectSource);
    if (action.type === "project-preflight") return preflightCurrentProject(project);
    if (typeof action.profileId !== "string") throw new Error("Invalid publishing profile");
    const profile = project.publishing.profiles.find((candidate) => candidate.id === action.profileId);
    if (!profile) throw new Error("Publishing profile not found");
    return action.type === "project-preview" ? previewProject(project, profile) : publishProject(project, profile);
  }
  throw new Error(`Unsupported detached View action: ${action.type}`);
}
function zoomEditorFont(dir: 1 | -1): void {
  applyEditorFontScale(stepEditorFontScale(currentEditorFontScale(), dir));
}
const helpPanel = mountHelpPanel();
const settingsPanel = mountSettingsPanel({
  onLocale: (l) => applyLocale(l),
  onTheme: (th) => applyTheme(th),
  getTheme: currentTheme,
  onEditorWidth: (w) => applyEditorWidth(w),
  getEditorWidth: currentEditorWidth,
  onEditorMode: (mode) => applyEditorMode(mode),
  getEditorMode: currentEditorMode,
  onFocusMode: (enabled) => applyFocusMode(enabled),
  getFocusMode: () => focusMode,
  onTypewriterMode: (enabled) => applyTypewriterMode(enabled),
  getTypewriterMode: () => typewriterMode,
  onUiScale: (scale) => { applyUiScale(scale); settingsPanel.refresh(); },
  getUiScale: currentUiScale,
  onHelp: () => helpPanel.open(),
  onSetDefault: () => void commands.openDefaultAppsSettings(),
  onCheckUpdates: () => void checkForUpdates(true),
  getNamedLayouts: () => namedLayoutChoices(namedLayouts),
  getActiveNamedLayout: () => activeNamedLayout,
  onLoadNamedLayout: loadNamedLayout,
  onSaveNamedLayout: saveNamedLayout,
  onDeleteNamedLayout: deleteNamedLayout,
  onExportLayout: exportLayoutSettings,
  onImportLayout: importLayoutSettings,
  onResetLayout: resetLayoutSettings,
  getLayoutSummary: layoutSummary,
});
layoutModeControl = mountLayoutModeControl(editorToolbar, currentEditorMode, (mode) => applyEditorMode(mode));
function applyLocale(l: Locale): void {
  setLocale(l);
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
  void commands.setMenuLabels(menuLabels()).then((r) => { if (r.status === "error") console.warn(r.error); });
  syncActiveUI();
  settingsPanel.refresh();
  broadcastViewWindowPresentation();
  scheduleSaveSettings();
}
const settingsSaveScheduler = createSettingsSaveScheduler(
  () => {
    void commands.saveSettings(settingsSnapshot()).then((result) => {
      if (import.meta.env.VITE_WDIO === "1" && result.status === "ok") {
        document.documentElement.dataset.wdioSavedWindowCount = String(viewWindowHost?.layoutSnapshot().windows.length ?? 0);
      }
    });
  },
  500,
);
const showHotExitError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  errorBanner.show(tr("error.save", { msg: message }));
};
const hotExitStore = createHotExitStore(
  () => paneWorkspace.hotExitSnapshot(currentFolder),
  async (snapshot) => {
    const result = await commands.saveHotExit(snapshot);
    if (result.status === "error") throw new Error(result.error);
  },
  async () => {
    const result = await commands.clearHotExit();
    if (result.status === "error") throw new Error(result.error);
  },
  250,
  showHotExitError,
  false,
);
function scheduleSaveSettings() {
  settingsSaveScheduler.schedule();
}
function saveSettingsNow(): void {
  settingsSaveScheduler.saveNow();
}
if (import.meta.env.VITE_WDIO === "1") {
  window.addEventListener("rune:wdio-save-shutdown-layout", () => {
    void viewWindowHost?.prepareForShutdown()
      .then(() => {
        return commands.saveSettings(settingsSnapshot());
      })
      .then((result) => {
        if (result?.status === "ok") document.documentElement.dataset.wdioShutdownSaved = "true";
      });
  });
}

function baseName(p: string): string { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; }
function exportTitle(): string {
  const path = activePane().activePath();
  return path ? baseName(path).replace(/\.(md|markdown)$/i, "") : "untitled";
}
function revealActive(): void {
  const path = activePane().activePath();
  if (path) void revealItemInDir(path);
}
function linkTargetKey(path: string | null): string {
  return (path ?? "").replace(/\\/g, "/").toLocaleLowerCase();
}
function linkTargetsFor(path: string | null): LinkTarget[] {
  return workspaceLinkTargets.get(linkTargetKey(path)) ?? [];
}
function refreshLinkTargets(path: string | null): Promise<void> {
  const folder = currentFolder;
  if (!folder) return Promise.resolve();
  const key = linkTargetKey(path);
  if (workspaceLinkTargets.has(key)) return Promise.resolve();
  const existing = workspaceLinkTargetLoads.get(key);
  if (existing) return existing;
  const version = workspaceLinkTargetVersion;
  let load: Promise<void>;
  load = commands.workspaceIndexLinkTargets(folder, path).then((result) => {
    if (version !== workspaceLinkTargetVersion || result.status !== "ok"
      || !currentFolder || !samePath(currentFolder, folder)) return;
    workspaceLinkTargets.set(key, result.data);
    if (typeof paneWorkspace !== "undefined" && samePath(activePane().activePath() ?? "", path ?? "")) {
      refreshMarkdownLinkDiagnostics(activeView());
    }
  }).finally(() => {
    if (workspaceLinkTargetLoads.get(key) === load) workspaceLinkTargetLoads.delete(key);
  });
  workspaceLinkTargetLoads.set(key, load);
  return load;
}
function extraExts(getDocPath: () => string | null) {
  return [
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.docChanged) {
        refreshStatus();
        refreshOutline();
        findReplacePanel?.refresh();
        if (u.docChanged) {
          refreshProperties();
          scheduleReferencesRefresh();
        }
      }
    }),
    findHighlightExtension(),
    writingModesExtension(() => ({ focus: focusMode, typewriter: typewriterMode })),
    ...markdownLinkExtensions({
      getTargets: () => linkTargetsFor(getDocPath()),
      getCurrentPath: getDocPath,
      diagnosticMessage: (kind, href) => tr(`link.diagnostic.${kind}`, { href }),
      openLink: (path, line) => {
        void (async () => {
          if (await openPath(path)) {
            if (line !== null) jumpToLine(line);
            else activeView().focus();
          }
        })();
      },
      completionSources: [citationCompletionSource(() => citationLibrary.entries)],
    }),
    citationLintExtension(() => citationLibrary.entries, (key) => tr("citation.diagnostic.missing", { key })),
    Prec.highest(keymap.of([{ key: "Mod-k", run: () => { palette.toggle(); return true; }, preventDefault: true }])),
  ];
}

function refreshStatus(): void {
  if (typeof paneWorkspace === "undefined") return;
  const view = activeView();
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  chrome.setStatus(text, line.number, head - line.from + 1);
}
function refreshOutline(): void {
  if (typeof paneWorkspace === "undefined") return;
  const view = activeView();
  outlinePanel.render(parseHeadings(view.state.doc.toString()));
  outlinePanel.setActiveLine(view.state.doc.lineAt(view.state.selection.main.head).number);
}
function syncActiveUI(): void {
  if (typeof paneWorkspace === "undefined") return;
  const pane = activePane();
  const path = pane.activePath();
  chrome.setTitle(path ? baseName(path) : tr("doc.untitled"), pane.activeDirty());
  tree.setActive(path);
  refreshStatus();
  refreshOutline();
  void refreshLinkTargets(path);
  void refreshBacklinks();
  refreshProperties();
  void refreshReferences();
  broadcastViewWindowContext();
}

function refreshProperties(): void {
  if (!propertiesPanel) return;
  propertiesPanel.render(typeof paneWorkspace === "undefined" ? null : activeView().state.doc.toString());
}

function refreshTags(): void {
  void tagsPanel?.refresh(currentFolder);
}

function scheduleReferencesRefresh(): void {
  if (!referencesPanel) return;
  if (referencesTimer !== undefined) window.clearTimeout(referencesTimer);
  referencesTimer = window.setTimeout(() => {
    referencesTimer = undefined;
    void refreshReferences();
  }, 200);
}

async function refreshReferences(): Promise<void> {
  const project = citationProject;
  const root = currentFolder;
  const request = ++referencesLoad;
  if (!root || !project) {
    referencesState = "noProject";
    referencesPanel?.render(referencesState);
    broadcastViewWindowContext();
    return;
  }
  referencesState = "loading";
  referencesPanel?.render(referencesState);
  try {
    const documents = await projectDocuments(project);
    if (request !== referencesLoad || !currentFolder || !samePath(currentFolder, root)) return;
    const activePath = activePane().activePath();
    let activeRelative: string | null = null;
    if (activePath) {
      try { activeRelative = projectRelativePath(root, activePath); } catch { /* loose file */ }
    }
    const currentMarkdown = activeRelative ? activeView().state.doc.toString() : null;
    referencesState = buildReferenceItems(citationLibrary, documents.map((document) => ({
      path: document.path,
      markdown: document.path === activeRelative && currentMarkdown !== null ? currentMarkdown : document.markdown,
    })), activeRelative);
    referencesPanel?.render(referencesState);
    broadcastViewWindowContext();
  } catch {
    if (request === referencesLoad) {
      referencesState = "error";
      referencesPanel?.render(referencesState);
      broadcastViewWindowContext();
    }
  }
}

async function readCitationLibrary(project: RuneProject, root: string): Promise<CitationLibrary> {
  const libraries = await Promise.all(project.bibliography.map(async (path) => {
    const result = await commands.readFile(projectResourceAbsolutePath(root, path));
    return result.status === "ok" ? parseBibTeX(result.data, path) : { entries: [], duplicates: [] };
  }));
  return mergeCitationLibraries(libraries);
}

async function refreshCitationState(root: string): Promise<void> {
  const request = ++citationLoad;
  const manifest = await loadProjectManifest(projectManifestPath(root));
  let project: RuneProject | null = null;
  let library: CitationLibrary = { entries: [], duplicates: [] };
  if (manifest.status === "ok" && manifest.source !== null) {
    try {
      project = parseProject(manifest.source);
      library = await readCitationLibrary(project, root);
    } catch {
      project = null;
    }
  }
  if (request !== citationLoad || !currentFolder || !samePath(currentFolder, root)) return;
  citationProject = project;
  citationLibrary = library;
  if (typeof paneWorkspace !== "undefined") refreshMarkdownLinkDiagnostics(activeView());
  void refreshReferences();
}

async function projectDocuments(project: RuneProject): Promise<ProjectDocument[]> {
  const root = currentFolder;
  if (!root) throw new Error("No workspace folder");
  const paths = new Map(workspaceFiles.map((file) => [projectRelativePath(root, file.path), file.path]));
  const documents = await Promise.all(project.files.map(async (path) => {
    const absolutePath = paths.get(path);
    if (!absolutePath) throw new Error(`Missing project document: ${path}`);
    const result = await commands.readFile(absolutePath);
    if (result.status === "error") throw new Error(result.error);
    return { path, absolutePath, markdown: result.data };
  }));
  if (!currentFolder || !samePath(currentFolder, root)) throw new Error("Workspace changed while building project");
  return documents;
}

async function preflightCurrentProject(project: RuneProject): Promise<ProjectDiagnostic[]> {
  const root = currentFolder;
  if (!root) throw new Error("No workspace folder");
  const files = workspaceFiles.map((file) => ({ path: projectRelativePath(root, file.path), absolutePath: file.path }));
  const diagnostics = await preflightProject(project, root, files);
  if (!currentFolder || !samePath(currentFolder, root)) throw new Error("Workspace changed during project preflight");
  return diagnostics;
}

function projectExportOptions(profile: PublishingProfile, library: CitationLibrary) {
  return {
    workspaceRoot: currentFolder ?? undefined,
    theme: profile.theme,
    pageSize: profile.pageSize,
    margins: profile.margins,
    pageBreakDocuments: profile.pageBreakDocuments,
    tableOfContents: profile.tableOfContents,
    tableOfContentsDepth: profile.tableOfContentsDepth,
    metadata: profile.metadata,
    citationLibrary: library,
  };
}

async function projectPublication(project: RuneProject, profile: PublishingProfile): Promise<{
  publication: ProjectPublication;
  documents: ProjectDocument[];
}> {
  const documents = await projectDocuments(project);
  const root = currentFolder;
  if (!root) throw new Error("No workspace folder");
  const library = await readCitationLibrary(project, root);
  return { publication: await buildProjectPublication(project, documents, projectExportOptions(profile, library)), documents };
}

function previewPublicationHtml(publication: ProjectPublication): string {
  return materializeProjectHtml(publication, (asset) => isTauri()
    ? convertFileSrc(asset.sourcePath)
    : encodeURI(`file:///${asset.sourcePath.replace(/\\/g, "/")}`));
}

async function previewProject(project: RuneProject, profile: PublishingProfile): Promise<void> {
  try {
    const { publication } = await projectPublication(project, profile);
    showHtmlPreview(previewPublicationHtml(publication), tr("project.previewTitle", { title: project.title }), tr("project.close"));
  } catch (error) {
    console.error(error);
    errorBanner.show(tr("project.exportError"));
    throw error;
  }
}

async function publishProject(project: RuneProject, profile: PublishingProfile): Promise<boolean> {
  try {
    const root = currentFolder;
    if (!root) throw new Error("No workspace folder");
    const { publication, documents } = await projectPublication(project, profile);
    if (profile.format === "pdf") {
      await printHtmlDocument(previewPublicationHtml(publication), project.title);
      return true;
    }
    const outputPath = projectOutputPath(root, profile.outputDirectory, project.title, profile.format);
    const contents = materializeProjectHtmlForOutput(publication, outputPath);
    const assets = publication.assets.map(({ sourcePath, relativePath }) => ({ sourcePath, relativePath }));
    const protectedPaths = documents.map((document) => document.absolutePath!);
    const result = profile.format === "html"
      ? await commands.publishProjectHtml(root, outputPath, contents, assets, protectedPaths)
      : await (async () => {
          const available = await commands.pandocAvailable();
          if (available.status === "error") throw new Error(available.error);
          if (!available.data) throw new Error(tr("project.pandocUnavailable"));
          return commands.publishProjectExternal(root, outputPath, contents, assets, protectedPaths);
        })();
    if (result.status === "error") throw new Error(result.error);
    return true;
  } catch (error) {
    console.error(error);
    errorBanner.show(tr("project.publishError", { msg: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

async function refreshBacklinks(): Promise<void> {
  const folder = currentFolder;
  const path = typeof paneWorkspace === "undefined" ? null : activePane().activePath();
  const load = ++backlinksLoad;
  if (!folder || !path) {
    backlinksState = "noDocument";
    backlinksPanel?.render(backlinksState);
    broadcastViewWindowContext();
    return;
  }
  backlinksState = "loading";
  backlinksPanel?.render(backlinksState);
  const result = await commands.workspaceIndexBacklinks(folder, path);
  if (load !== backlinksLoad || !currentFolder || !samePath(currentFolder, folder)
    || !samePath(activePane().activePath() ?? "", path)) return;
  backlinksState = result.status === "ok" ? result.data : "error";
  backlinksPanel?.render(backlinksState);
  broadcastViewWindowContext();
}
async function openPath(path: string): Promise<boolean> {
  const opened = await paneWorkspace.openPathInActivePane(path);
  if (!opened) return false;
  // Opened a loose file with no workspace open; load its folder into the tree.
  // `await` is deliberate: currentFolder must be set before scheduleSaveSettings() captures lastFolder.
  if (!currentFolder) { const dir = parentDir(path); if (dir) await loadFolder(dir).catch(() => {}); }
  scheduleSaveSettings();
  syncActiveUI();
  return true;
}
const nativeFileOpenQueue = createNativeFileOpenQueue(openPath);
async function loadDroppedFileFolder(path: string): Promise<void> {
  if (currentFolder) return;
  const dir = parentDir(path);
  if (dir) await loadFolder(dir).catch(() => {});
}
async function openDroppedPathInPane(paneId: string, path: string): Promise<boolean> {
  const opened = await paneWorkspace.openPathInPane(paneId, path);
  if (!opened) return false;
  await loadDroppedFileFolder(path);
  scheduleSaveSettings();
  syncActiveUI();
  return true;
}
async function splitDroppedPathInPane(
  paneId: string,
  path: string,
  direction: "row" | "column",
  side: "before" | "after",
): Promise<boolean> {
  const createdPaneId = await paneWorkspace.splitPaneAndOpen(paneId, path, direction, side);
  if (!createdPaneId) return false;
  await loadDroppedFileFolder(path);
  scheduleSaveSettings();
  syncActiveUI();
  return true;
}
function newDoc(): void {
  activePane().newDoc();
  syncActiveUI();
  scheduleSaveSettings();
}
async function openFile(): Promise<void> {
  const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
  if (typeof selected === "string") await openPath(selected);
}
function flattenFiles(nodes: import("./ipc/bindings").FileNode[]): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const walk = (ns: import("./ipc/bindings").FileNode[]) => { for (const n of ns) { if (n.isDir) walk(n.children); else out.push({ name: n.name, path: n.path }); } };
  walk(nodes);
  return out;
}
async function refreshWorkspaceHeadings(
  dir: string,
  files: { name: string; path: string }[],
  changedPaths?: string[],
): Promise<void> {
  const load = ++workspaceHeadingLoad;
  let indexed = changedPaths
    ? await commands.updateWorkspaceIndex(dir, changedPaths)
    : await commands.rebuildWorkspaceIndex(dir);
  if (changedPaths && indexed.status === "error") {
    indexed = await commands.rebuildWorkspaceIndex(dir);
  }
  if (indexed.status === "ok") {
    const result = await commands.workspaceIndexHeadings(dir);
    if (load === workspaceHeadingLoad && currentFolder && samePath(currentFolder, dir)) {
      workspaceLinkTargetVersion++;
      workspaceLinkTargets.clear();
      workspaceLinkTargetLoads.clear();
      void refreshLinkTargets(typeof paneWorkspace === "undefined" ? null : activePane().activePath());
      void refreshBacklinks();
      refreshTags();
      if (result.status === "ok") {
        workspaceHeadings = result.data;
        return;
      }
    }
  }
  const headings = await collectWorkspaceHeadings(files, async (path) => {
    const result = await commands.readFile(path);
    return result.status === "ok" ? result.data : null;
  });
  if (load === workspaceHeadingLoad && currentFolder && samePath(currentFolder, dir)) workspaceHeadings = headings;
}
async function refreshFolderContents(dir: string): Promise<void> {
  const res = await commands.listDir(dir);
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.openFolder", { msg: res.error })); tree.showError(); throw new Error(res.error); }
  workspaceTree = res.data;
  tree.render(workspaceTree, dir);
  workspaceFiles = flattenFiles(workspaceTree);
  void projectPanel?.refresh(dir, workspaceFiles);
  broadcastViewWindowContext();
}
async function loadFolder(dir: string): Promise<void> {
  await refreshFolderContents(dir);
  currentFolder = dir;
  await refreshCitationState(dir);
  workspaceHeadings = [];
  await refreshWorkspaceHeadings(dir, workspaceFiles);
  void commands.watchFolder(dir);
}
async function openFolder(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  try { await loadFolder(dir); } catch { return; }
  scheduleSaveSettings();
}
async function refreshTree(): Promise<void> {
  if (currentFolder) await refreshFolderContents(currentFolder).catch(() => {});
}
async function copyPath(p: string): Promise<void> {
  try { await navigator.clipboard.writeText(p); } catch (e) { console.error(e); }
}
function pathChangeDestination(root: string, source: string, input: string): string {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(input)) return input;
  const separator = root.includes("\\") ? "\\" : "/";
  if (input.includes("/") || input.includes("\\")) {
    return `${root.replace(/[\\/]$/, "")}${separator}${input.replace(/^[\\/]+/, "")}`;
  }
  const split = Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\"));
  return split >= 0 ? `${source.slice(0, split + 1)}${input}` : input;
}
async function synchronizePathChange(plan: PathChangePlan): Promise<void> {
  await paneWorkspace.reconcilePathChange(plan);
  await refreshTree();
  if (currentFolder) {
    const headings = await commands.workspaceIndexHeadings(currentFolder);
    if (headings.status === "ok") workspaceHeadings = headings.data;
  }
  workspaceLinkTargetVersion++;
  workspaceLinkTargets.clear();
  workspaceLinkTargetLoads.clear();
  refreshTags();
  syncActiveUI();
  scheduleSaveSettings();
}
async function renameEntry(path: string, name: string): Promise<void> {
  const next = await promptModal({ title: tr("prompt.rename"), value: name });
  if (!next || next === name) return;
  if (!currentFolder) return;
  const destination = pathChangeDestination(currentFolder, path, next);
  await runPathChange(currentFolder, path, destination, {
    plan: commands.planPathChange,
    apply: commands.applyPathChange,
    dirtyPaths: () => paneWorkspace.dirtyPaths(),
    preview: showPathChangePreview,
    synchronize: synchronizePathChange,
    showError: (message) => errorBanner.show(tr("error.fileOp", { msg: message })),
    dirtyMessage: tr("pathChange.dirty"),
  });
}
async function deleteEntry(path: string, name: string): Promise<void> {
  if (!confirm(tr("confirm.delete", { name }))) return;
  const res = await commands.deletePath(path);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
}
async function newFileIn(dir: string): Promise<void> {
  const name = await promptModal({ title: tr("prompt.newFile"), value: "untitled.md" });
  if (!name) return;
  const res = await commands.createFile(dir, name);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
  await openPath(res.data);
}
async function newFolderIn(dir: string): Promise<void> {
  const name = await promptModal({ title: tr("prompt.newFolder"), value: "new-folder" });
  if (!name) return;
  const res = await commands.createDir(dir, name);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
}
function fileTreeMenu(node: import("./ipc/bindings").FileNode, x: number, y: number): void {
  const items: MenuItem[] = node.isDir
    ? [
        { label: tr("menu.newFile"), run: () => void newFileIn(node.path) },
        { label: tr("menu.newFolder"), run: () => void newFolderIn(node.path) },
        { label: tr("cmd.reveal"), run: () => void revealItemInDir(node.path) },
        { label: tr("menu.copyPath"), run: () => void copyPath(node.path) },
        { label: tr("menu.rename"), run: () => void renameEntry(node.path, node.name) },
        { label: tr("menu.delete"), run: () => void deleteEntry(node.path, node.name), danger: true },
      ]
    : [
        { label: tr("menu.open"), run: () => void openPath(node.path) },
        { label: tr("cmd.reveal"), run: () => void revealItemInDir(node.path) },
        { label: tr("menu.copyPath"), run: () => void copyPath(node.path) },
        { label: tr("menu.rename"), run: () => void renameEntry(node.path, node.name) },
        { label: tr("menu.delete"), run: () => void deleteEntry(node.path, node.name), danger: true },
      ];
  showContextMenu(x, y, items);
}
function closeOthers(keepId: string): void {
  activePane().closeOtherTabs(keepId);
  syncActiveUI();
  scheduleSaveSettings();
}
function tabMenu(paneId: string, id: string, x: number, y: number): void {
  paneWorkspace.setActivePane(paneId);
  const t = activePane().tabInfo(id);
  const items: MenuItem[] = [
    { label: tr("cmd.closeTab"), run: () => requestClose(id) },
    { label: tr("menu.closeOthers"), run: () => closeOthers(id) },
  ];
  if (t?.path) {
    items.push({ label: tr("menu.copyPath"), run: () => void copyPath(t.path!) });
    items.push({ label: tr("cmd.reveal"), run: () => void revealItemInDir(t.path!) });
  }
  showContextMenu(x, y, items);
}
function requestClose(id: string): void {
  activePane().closeTab(id);
  syncActiveUI();
  scheduleSaveSettings();
}
async function doSave(): Promise<void> {
  const pane = activePane();
  const activeId = pane.activeTabId();
  if (!activeId) return;
  const t = pane.tabInfo(activeId);
  if (!t) return;
  if (t.path) {
    await pane.saveActive();
    syncActiveUI();
    return;
  }
  await doSaveAs();
}

async function doSaveAs(): Promise<void> {
  const pane = activePane();
  if (!pane.activeTabId()) return;
  const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (typeof chosen !== "string") return;
  const res = await pane.saveActiveAs(chosen);
  if (!res) return;
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.save", { msg: res.error })); return; }
  syncActiveUI();
  scheduleSaveSettings();
}

function flipTheme(): void {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  scheduleSaveSettings();
}
function paletteItems(): PaletteItem[] {
  const layoutChoices = namedLayoutChoices(namedLayouts);
  const cmds: PaletteItem[] = [
    { label: tr("cmd.newTab"), run: () => newDoc() },
    { label: tr("cmd.openFile"), run: () => void openFile() },
    { label: tr("cmd.openFolder"), run: () => void openFolder() },
    { label: tr("menu.newFile"), run: () => { if (currentFolder) void newFileIn(currentFolder); } },
    { label: tr("menu.newFolder"), run: () => { if (currentFolder) void newFolderIn(currentFolder); } },
    { label: tr("cmd.save"), run: () => void doSave() },
    { label: tr("cmd.saveAs"), run: () => void doSaveAs() },
    { label: tr("cmd.toggleTheme"), run: () => flipTheme() },
    { label: tr("cmd.toggleWidth"), run: () => flipEditorWidth() },
    { label: tr("cmd.toggleSourceMode"), run: () => flipEditorMode() },
    { label: tr("cmd.toggleFocusMode"), run: () => applyFocusMode(!focusMode) },
    { label: tr("cmd.toggleTypewriterMode"), run: () => applyTypewriterMode(!typewriterMode) },
    { label: tr("cmd.toggleFocusLayout"), run: () => applyFocusLayout(!focusLayout) },
    { label: tr("cmd.closeTab"), run: () => { const id = activePane().activeTabId(); if (id) requestClose(id); } },
    { label: tr("cmd.exportHtml"), run: () => void exportHtml(activeView().state.doc.toString(), exportTitle()) },
    { label: tr("cmd.project"), run: () => commandRegistry.execute(openViewCommandId("project")) },
    { label: tr("cmd.publishAgain"), run: () => { commandRegistry.execute(openViewCommandId("project")); void projectPanel?.publishAgain(); } },
    { label: tr("cmd.exportPdf"), run: () => void exportPdf(activeView().state.doc.toString(), exportTitle()) },
    { label: tr("cmd.findReplace"), run: () => findReplacePanel?.open() },
    ...commandRegistry.commands()
      .filter((command) => command.palette !== false)
      .map((command) => ({ label: command.title(), run: () => commandRegistry.execute(command.id) })),
    { label: tr("cmd.reveal"), run: () => revealActive() },
    { label: tr("settings.title"), run: () => settingsPanel.open() },
    ...layoutChoices.map((choice) => ({ label: `${tr("layout.load")}: ${namedLayoutLabel(choice)}`, run: () => void loadNamedLayout(choice.value) })),
    { label: tr("layout.saveAs"), run: () => void saveNamedLayout(false) },
    ...namedLayouts.map(({ name }) => ({ label: `${tr("layout.delete")}: ${name}`, run: () => void deleteNamedLayout(`saved:${name}`) })),
    { label: tr("cmd.help"), run: () => helpPanel.open() },
    ...LOCALES.map(({ code, label }) => ({ label: `${tr("cmd.language")}: ${label}`, run: () => applyLocale(code) })),
  ];
  const headings = typeof paneWorkspace === "undefined"
    ? []
    : headingPaletteItems(activeView().state.doc.toString(), jumpToLine);
  const workspaceSymbols = typeof paneWorkspace === "undefined"
    ? []
    : workspaceHeadingPaletteItems(workspaceHeadings, activePane().activePath(), (path, line) => {
      void (async () => { if (await openPath(path)) jumpToLine(line); })();
    });
  const files: PaletteItem[] = workspaceFiles.map((f) => ({ label: f.name, hint: f.path, run: () => void openPath(f.path) }));
  return [...cmds, ...headings, ...workspaceSymbols, ...files];
}
const palette = mountCommandPalette(paletteItems);
function jumpToLine(n: number): void {
  const view = activeView();
  const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  view.focus();
}
findReplacePanel = mountFindReplacePanel({
  getText: () => activeView().state.doc.toString(),
  getCursor: () => activeView().state.selection.main.head,
  getSelectionText: () => {
    const view = activeView();
    const range = view.state.selection.main;
    return range.empty ? "" : view.state.sliceDoc(range.from, range.to);
  },
  getSelectionRange: () => {
    const view = activeView();
    const range = view.state.selection.main;
    return range.empty ? null : { from: range.from, to: range.to };
  },
  selectRange: (from, to, options) => {
    const view = activeView();
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    if (options?.focus !== false) view.focus();
  },
  replaceRange: (from, to, insert) => {
    const view = activeView();
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
    view.focus();
  },
  replaceRanges: (ranges, insert) => {
    if (ranges.length === 0) return;
    const view = activeView();
    view.dispatch({
      changes: ranges.map(({ from, to }) => ({ from, to, insert })),
      selection: { anchor: ranges[0].from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  },
  setHighlights: (matches, activeIndex) => {
    activeView().dispatch({ effects: setFindHighlights.of({ matches, activeIndex }) });
  },
  clearHighlights: () => {
    activeView().dispatch({ effects: clearFindHighlights.of(undefined) });
  },
});
async function restore(): Promise<void> {
  const [res, recoveryResult] = await Promise.all([
    commands.loadSettings(),
    commands.loadHotExit(),
  ]);
  const recovery = recoveryResult.status === "ok" ? parseHotExitSnapshot(recoveryResult.data) : null;
  const s = res.status === "ok" ? res.data : { theme: null, lastFolder: null, openTabs: [], locale: null, editorWidth: null, editorMode: null, sidebarWidth: null, layout: null, workbenchLayout: null, viewWindowLayout: null, namedLayouts: null, activeNamedLayout: null, focusMode: null, typewriterMode: null, paneLayout: null, uiScale: null, editorFontScale: null };
  document.documentElement.setAttribute("data-theme", s.theme === "light" || s.theme === "dark" ? s.theme : (prefersDark() ? "dark" : "light"));
  document.documentElement.setAttribute("data-editor-width", s.editorWidth === "wide" ? "wide" : "readable");
  editorMode = normalizeEditorMode(s.editorMode);
  document.documentElement.setAttribute("data-editor-mode", editorMode);
  paneWorkspace.setEditorMode(editorMode);
  applyFocusMode(s.focusMode === true, false);
  applyTypewriterMode(s.typewriterMode === true, false);
  layoutModeControl?.setMode(editorMode);
  applyUiScale(s.uiScale ?? UI_SCALE_DEFAULT, false);
  workbench.restore(normalizePersistedWorkbenchLayout(s.workbenchLayout, s.layout, s.sidebarWidth), { emitChange: false });
  applySplitRatio(s.layout?.splitRatio ?? DEFAULT_LAYOUT.splitRatio, false);
  applyEditorFontScale(s.editorFontScale ?? EDITOR_FONT_DEFAULT, false);
  namedLayouts = normalizeSavedLayouts(s.namedLayouts);
  activeNamedLayout = typeof s.activeNamedLayout === "string" && resolveNamedLayout(s.activeNamedLayout, namedLayouts)
    ? s.activeNamedLayout
    : null;

  // Resolve the UI language BEFORE loading any content, so the app never flashes
  // a language the user didn't choose. On first run (no saved locale) we ask once
  // with a picker — pre-selecting a best-effort guess — and persist the choice.
  const validCodes = LOCALES.map((x) => x.code) as string[];
  const saved = s.locale && validCodes.includes(s.locale) ? (s.locale as Locale) : null;
  const firstRun = saved === null;
  setLocale(saved ?? detectLocale());
  if (firstRun && import.meta.env.VITE_WDIO !== "1") {
    setLocale(await showLanguagePicker(getLocale()));
  }
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
  void commands.setMenuLabels(menuLabels()).then((r) => { if (r.status === "error") console.warn(r.error); });

  if (s.lastFolder) { await loadFolder(s.lastFolder).catch(() => {}); }
  await paneWorkspace.restore(normalizePaneWorkspaceSnapshot(s.paneLayout, s.openTabs));
  let loadedRestoredFolder = false;
  if (!currentFolder) {
    const firstRestoredPath = paneWorkspace.snapshot().panes.flatMap((pane) => pane.openTabs)[0];
    const dir = firstRestoredPath ? parentDir(firstRestoredPath) : null;
    if (dir) {
      try {
        await loadFolder(dir);
        loadedRestoredFolder = true;
      } catch {}
    }
  }
  if (recovery) {
    await paneWorkspace.restoreHotExit(recovery);
  }
  hotExitStore.enable(false);
  if (recovery) {
    hotExitStore.schedule();
    await hotExitStore.flush().catch(showHotExitError);
    if (import.meta.env.VITE_WDIO === "1") document.documentElement.dataset.wdioHotExitRecovered = "true";
  }
  if (!activePane().activeTabId()) newDoc();
  syncActiveUI();
  if (viewWindowHost) {
    const viewWindows = normalizeViewWindowLayout(s.viewWindowLayout, workbench.snapshot());
    if (import.meta.env.VITE_WDIO === "1" && viewWindows.windows.length > 0) {
      document.documentElement.dataset.wdioPendingWindowCount = String(viewWindows.windows.length);
      window.addEventListener("rune:wdio-restore-view-windows", () => {
        void viewWindowHost!.restoreLayout(viewWindows).then(() => {
          delete document.documentElement.dataset.wdioPendingWindowCount;
        }).catch((error) => console.warn(error));
      }, { once: true });
    } else {
      await viewWindowHost.restoreLayout(viewWindows);
    }
  }

  // Persist startup-only migrations after folder fallback has stabilized lastFolder.
  if (firstRun || !s.workbenchLayout || !s.paneLayout || loadedRestoredFolder) saveSettingsNow();

  // Wait for the listener before marking the Rust side ready and draining a queued launch.
  await openFileListenerReady;
  // If Rune was launched by double-clicking Markdown files, open them in arrival order.
  const launch = await commands.takeLaunchFile();
  await nativeFileOpenQueue.drainLaunchFiles(launch.status === "ok" ? launch.data : []);
  void checkForUpdates(false);
}

const banner = mountConflictBanner(document.getElementById("main-col")!, {
  onReload: () => void reloadActive(),
  onKeep: () => {},
});
const errorBanner = mountErrorBanner(document.getElementById("main-col")!);
const updateBanner = mountUpdateBanner(document.getElementById("main-col")!);
const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const RELEASES_URL = "https://github.com/JangHyun-bin/Rune/releases/latest";

let updateChecking = false;
async function checkForUpdates(manual: boolean): Promise<void> {
  if (updateChecking) return;
  updateChecking = true;
  try {
    const update = await check();
    if (!update) { if (manual) settingsPanel.setUpdateStatus(tr("update.upToDate")); return; }
    if (manual) settingsPanel.setUpdateStatus("");
    if (manual) settingsPanel.close();
    if (isMacPlatform) {
      updateBanner.showManual(update.version, () => void openUrl(RELEASES_URL));
    } else {
      updateBanner.showAuto(update.version, () => void (async () => {
        updateBanner.setDownloading();
        try {
          await update.downloadAndInstall(() => {});
          await relaunch();
        } catch (e) { console.error(e); updateBanner.hide(); errorBanner.show(tr("update.installFailed")); }
      })());
    }
  } catch (e) {
    console.error(e);
    if (manual) settingsPanel.setUpdateStatus(tr("update.failed"));
  } finally {
    updateChecking = false;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}
async function reloadActive(): Promise<void> {
  const pane = activePane();
  const path = pane.activePath();
  if (!path) return;
  const res = await commands.readFile(path);
  if (res.status === "error") { console.error(res.error); return; }
  pane.replaceActiveText(res.data, { markSaved: true });
  syncActiveUI();
}
let fsTimer: number | undefined;
const pendingFsPaths = new Set<string>();
let nativeDragHasMarkdown = false;
let nativeDragPreviousTarget: ResolvedDropTarget | null = null;
function onFsChange(paths: string[]): void {
  paths.forEach((path) => pendingFsPaths.add(path));
  if (fsTimer !== undefined) clearTimeout(fsTimer);
  fsTimer = window.setTimeout(async () => {
    const changedPaths = [...pendingFsPaths];
    pendingFsPaths.clear();
    const folder = currentFolder;
    if (folder) {
      await refreshFolderContents(folder).catch(() => {});
      void refreshCitationState(folder);
      if (currentFolder && samePath(currentFolder, folder)) {
        void refreshWorkspaceHeadings(folder, workspaceFiles, changedPaths);
      }
    }
    const pane = activePane();
    const path = pane.activePath();
    if (path && changedPaths.some((p) => samePath(p, path))) {
      if (!pane.activeDirty()) await reloadActive();
      else banner.show();
    }
  }, 250);
}
function elementForPane(selector: string, paneId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find((element) => element.dataset.paneId === paneId) ?? null;
}
function resolveDropTarget(point: { x: number; y: number }): ResolvedDropTarget {
  const element = document.elementFromPoint(point.x, point.y);
  const tabbar = element?.closest<HTMLElement>(".pane-tabbar");
  if (tabbar?.dataset.paneId) return { kind: "tabbar", paneId: tabbar.dataset.paneId };

  const pane = element?.closest<HTMLElement>(".editor-pane-root");
  if (!pane?.dataset.paneId) return { kind: "none", paneId: null };
  const previous = nativeDragPreviousTarget?.kind === "pane-edge" && nativeDragPreviousTarget.paneId === pane.dataset.paneId
    ? {
        kind: "pane-edge" as const,
        direction: nativeDragPreviousTarget.direction,
        side: nativeDragPreviousTarget.side,
      }
    : null;
  return { paneId: pane.dataset.paneId, ...hitPaneDropZone(pane.getBoundingClientRect(), point, { previous }) };
}
function setDropOverlayRect(rect: { left: number; top: number; width: number; height: number }, kind: string): void {
  dropOverlay.dataset.kind = kind;
  dropOverlay.style.left = `${rect.left}px`;
  dropOverlay.style.top = `${rect.top}px`;
  dropOverlay.style.width = `${rect.width}px`;
  dropOverlay.style.height = `${rect.height}px`;
  dropOverlay.classList.remove("hidden");
}
function hideDropOverlay(): void {
  dropOverlay.classList.add("hidden");
}
function showDropOverlay(target: ResolvedDropTarget): void {
  if (target.kind === "none") {
    hideDropOverlay();
    return;
  }

  if (target.kind === "tabbar") {
    const tabbar = elementForPane(".pane-tabbar", target.paneId);
    if (!tabbar) { hideDropOverlay(); return; }
    setDropOverlayRect(tabbar.getBoundingClientRect(), "tabbar");
    return;
  }

  const pane = elementForPane(".editor-pane-root", target.paneId);
  if (!pane) { hideDropOverlay(); return; }
  const rect = pane.getBoundingClientRect();
  setDropOverlayRect(dropZoneRect(rect, target), target.kind);
}
function safeListen<T>(event: string, handler: (event: Event<T>) => void): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  try {
    return listen<T>(event, handler).then(() => undefined).catch((error) => console.warn(error));
  } catch (error) {
    console.warn(error);
    return Promise.resolve();
  }
}
void safeListen<string[]>("fs-change", (e) => onFsChange(e.payload));
// A .md opened via file association while Rune is already running (single-instance / macOS).
const openFileListenerReady = safeListen<string>("open-file", (e) => { void nativeFileOpenQueue.openLiveFile(e.payload); });
function menuAction(id: string): void {
  switch (id) {
    case "file.newTab": newDoc(); break;
    case "file.open": void openFile(); break;
    case "file.openFolder": void openFolder(); break;
    case "file.save": void doSave(); break;
    case "file.saveAs": void doSaveAs(); break;
    case "file.exportHtml": void exportHtml(activeView().state.doc.toString(), exportTitle()); break;
    case "file.exportPdf": void exportPdf(activeView().state.doc.toString(), exportTitle()); break;
    case "app.quit": void getCurrentWebviewWindow().close(); break;
    case "view.toggleSidebar": commandRegistry.execute(togglePartCommandId("primarySidebar")); break;
    case "view.togglePanel": commandRegistry.execute(togglePartCommandId("panel")); break;
    case "view.toggleTheme": flipTheme(); break;
    case "view.toggleFocusMode": applyFocusMode(!focusMode); break;
    case "help.help": helpPanel.open(); break;
  }
}
void safeListen<string>("menu-action", (e) => menuAction(e.payload));
function bindNativeFileDrop(): void {
  if (!isTauri()) return;
  try {
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        nativeDragHasMarkdown = false;
        nativeDragPreviousTarget = null;
        hideDropOverlay();
        return;
      }

      if (payload.type === "enter") {
        nativeDragHasMarkdown = firstMarkdownPath(payload.paths) !== null;
      }
      if (!nativeDragHasMarkdown) {
        nativeDragPreviousTarget = null;
        hideDropOverlay();
        return;
      }

      const point = physicalToCssPoint(payload.position, window.devicePixelRatio);
      const target = resolveDropTarget(point);
      if (payload.type === "drop") {
        nativeDragHasMarkdown = false;
        nativeDragPreviousTarget = null;
        hideDropOverlay();
        void handleNativeFileDrop({
          paths: payload.paths,
          target,
          openInPane: openDroppedPathInPane,
          splitInPane: splitDroppedPathInPane,
        });
        return;
      }
      nativeDragPreviousTarget = target;
      showDropOverlay(target);
    }).catch((error) => console.warn(error));
  } catch (error) {
    console.warn(error);
  }
}

paneWorkspace = createPaneWorkspace({
  host: editorRoot,
  editorMode,
  extraExtensions: extraExts,
  initialSplitRatio: currentSplitRatio(),
  readFile: commands.readFile,
  writeFile: commands.writeFile,
  onActivePaneChange: () => syncActiveUI(),
  onActiveDocumentChange: () => {
    syncActiveUI();
    hotExitStore.schedule();
  },
  onRequestSaveSettings: scheduleSaveSettings,
  onReadError: (msg) => errorBanner.show(tr("error.readFile", { msg })),
  onSaveError: (msg) => errorBanner.show(tr("error.save", { msg })),
  onSplitRatioChange: (ratio) => applySplitRatio(ratio),
  onTabContextMenu: tabMenu,
  canCloseDirtyTab: () => confirm(tr("confirm.closeDirty")),
});
bindNativeFileDrop();
void restore().then(
  () => {
    settingsSaveScheduler.enable();
    if (import.meta.env.VITE_WDIO === "1") document.documentElement.dataset.wdioReady = "true";
  },
  (error) => {
    settingsSaveScheduler.enable(false);
    throw error;
  },
);

let mainClosePending = false;
if (isTauri()) void getCurrentWebviewWindow().onCloseRequested(async (event) => {
  if (mainClosePending) return;
  event.preventDefault();
  mainClosePending = true;
  try {
    await paneWorkspace.flushSaves();
    if (paneWorkspace.hasDirtyTabs()
      && !(await confirmDialog(tr("confirm.closeDirty"), { title: "Rune", kind: "warning" }))) {
      mainClosePending = false;
      viewWindowHost?.cancelShutdown();
      return;
    }
    await viewWindowHost?.prepareForShutdown();
    const saved = await commands.saveSettings(settingsSnapshot());
    if (saved.status === "error") throw new Error(saved.error);
    await hotExitStore.discard();
    await getCurrentWebviewWindow().destroy();
  } catch (error) {
    mainClosePending = false;
    viewWindowHost?.cancelShutdown();
    errorBanner.show(error instanceof Error ? error.message : String(error));
  }
});

window.addEventListener("blur", () => {
  void (async () => {
    await paneWorkspace.flushSaves();
    hotExitStore.schedule();
    await hotExitStore.flush().catch(showHotExitError);
  })();
});
window.addEventListener("resize", () => applySplitRatio(currentSplitRatio(), false));
window.addEventListener("keydown", (e) => {
  if (e.key === "F1") { e.preventDefault(); helpPanel.toggle(); return; }
  if (e.key === "F8") { e.preventDefault(); applyFocusMode(!focusMode); return; }
  if (e.key === "F9") { e.preventDefault(); applyTypewriterMode(!typewriterMode); return; }
  if (e.key === "F10") { e.preventDefault(); applyFocusLayout(!focusLayout); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoomEditorFont(-1); return; }
  if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomEditorFont(1); return; }
  if (mod && e.key === "0") { e.preventDefault(); applyEditorFontScale(EDITOR_FONT_DEFAULT); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); commandRegistry.execute(toggleViewCommandId("search")); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); findReplacePanel?.open(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); flipEditorWidth(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); flipEditorMode(); return; }
  if (mod && e.key === "Tab") { e.preventDefault(); const id = e.shiftKey ? activePane().prevTabId() : activePane().nextTabId(); if (id) activePane().switchTo(id); return; }
  if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); const id = activePane().nthTabId(Number(e.key)); if (id) activePane().switchTo(id); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); void doSaveAs(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newDoc(); return; }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); const id = activePane().activeTabId(); if (id) requestClose(id); return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); void exportHtml(activeView().state.doc.toString(), exportTitle()); return; }
});
