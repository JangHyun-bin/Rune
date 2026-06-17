import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editorState, createEditorView, type EditorMode } from "../editor/editor";
import { mountSplitPreview, type SplitPreview } from "../editor/splitPreview";
import { mountTabBar } from "./tabBar";
import {
  activeTab,
  closeTab as closeTabModel,
  emptyTabs,
  newUntitled,
  nextTabId as nextTabIdModel,
  nthTabId as nthTabIdModel,
  openOrFocus,
  prevTabId as prevTabIdModel,
  setActive,
  tabDirty,
  updateActiveText,
  type TabsState,
} from "./tabs";

export interface CommandResult<T> {
  status: "ok";
  data: T;
}

export interface CommandError {
  status: "error";
  error: string;
}

export interface EditorPaneOptions {
  id: string;
  host: HTMLElement;
  editorMode: EditorMode;
  extraExtensions?: () => Extension[];
  initialSplitRatio?: number;
  readFile: (path: string) => Promise<CommandResult<string> | CommandError>;
  writeFile: (path: string, contents: string) => Promise<CommandResult<null> | CommandError>;
  onActiveChange: (paneId: string) => void;
  onDirtyChange: (paneId: string) => void;
  onRequestSaveSettings: () => void;
  onReadError?: (message: string) => void;
  onSaveError?: (message: string) => void;
  onSplitRatioChange?: (ratio: number) => void;
  onTabContextMenu?: (paneId: string, tabId: string, x: number, y: number) => void;
  canCloseDirtyTab?: (paneId: string, tabId: string) => boolean;
  onEmptyPane?: (paneId: string) => boolean;
}

export interface EditorPane {
  id: string;
  root: HTMLElement;
  view: EditorView;
  openPath(path: string): Promise<boolean>;
  newDoc(): void;
  switchTo(tabId: string): void;
  closeTab(tabId: string): void;
  closeOtherTabs(keepId: string): void;
  activeTabId(): string | null;
  nextTabId(): string | null;
  prevTabId(): string | null;
  nthTabId(n: number): string | null;
  tabInfo(tabId: string): { id: string; path: string | null; dirty: boolean; active: boolean } | null;
  activePath(): string | null;
  activeText(): string;
  activeDirty(): boolean;
  tabsSnapshot(): { openTabs: string[]; activePath: string | null };
  setEditorMode(mode: EditorMode): void;
  saveActive(): Promise<void>;
  saveActiveAs(path: string): Promise<CommandResult<null> | CommandError | null>;
  replaceActiveText(text: string, options?: { markSaved?: boolean }): void;
  flushSaves(): Promise<void>;
  setSplitRatio(ratio: number): void;
  splitRatio(): number;
  destroy(): void;
}

function markTabSavedById(
  state: TabsState,
  tabId: string,
  path: string,
  savedText: string,
): { state: TabsState; updated: boolean } {
  let updated = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId || tab.path !== path) return tab;
    if (tab.currentText !== savedText) return tab;
    updated = true;
    return { ...tab, savedText };
  });
  return { state: updated ? { ...state, tabs } : state, updated };
}

function markTabSavedAsById(
  state: TabsState,
  tabId: string,
  expectedPath: string | null,
  path: string,
  savedText: string,
): { state: TabsState; updated: boolean } {
  let updated = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId || tab.path !== expectedPath) return tab;
    updated = true;
    return { ...tab, path, savedText };
  });
  return { state: updated ? { ...state, tabs } : state, updated };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createEditorPane(options: EditorPaneOptions): EditorPane {
  const { id } = options;
  let editorMode = options.editorMode;
  let tabs: TabsState = newUntitled(emptyTabs());
  const states = new Map<string, EditorState>();

  const root = document.createElement("div");
  root.className = "editor-pane-root";
  root.dataset.paneId = id;

  const tabbarHost = document.createElement("div");
  tabbarHost.className = "pane-tabbar";

  const editorHost = document.createElement("div");
  editorHost.className = "pane-editor";

  root.appendChild(tabbarHost);
  root.appendChild(editorHost);
  options.host.appendChild(root);

  let view: EditorView | null = null;
  let sourceHost = document.createElement("div");
  let splitPreview: SplitPreview | null = null;
  let splitResizerCleanup: (() => void) | null = null;
  let splitSourceRatio = clamp(options.initialSplitRatio ?? 0.5, 0.12, 0.88);
  const autosaveTimers = new Map<string, number>();
  const saveQueues = new Map<string, Promise<void>>();

  const tabBar = mountTabBar(tabbarHost, {
    paneId: id,
    onSelect: switchTo,
    onClose: closeTab,
    onContextMenu: (tabId, x, y) => options.onTabContextMenu?.(id, tabId, x, y),
  });

  root.addEventListener("mousedown", () => options.onActiveChange(id));

  function currentView(): EditorView {
    if (!view) throw new Error("Editor pane view has not been initialized");
    return view;
  }

  function activePath(): string | null {
    return activeTab(tabs)?.path ?? null;
  }

  function activeText(): string {
    return view?.state.doc.toString() ?? activeTab(tabs)?.currentText ?? "";
  }

  function activeDirty(): boolean {
    const tab = activeTab(tabs);
    return tab ? tabDirty(tab) : false;
  }

  function activeTabId(): string | null {
    return tabs.activeId;
  }

  function tabInfo(tabId: string): { id: string; path: string | null; dirty: boolean; active: boolean } | null {
    const tab = tabs.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return null;
    return { id: tab.id, path: tab.path, dirty: tabDirty(tab), active: tab.id === tabs.activeId };
  }

  function hasOnlyCleanUntitledTab(): boolean {
    const tab = tabs.tabs[0];
    return tabs.tabs.length === 1 && !!tab && tab.path === null && !tabDirty(tab);
  }

  function createState(doc: string): EditorState {
    return editorState(doc, onChange, options.extraExtensions?.() ?? [], editorMode, () => activeTab(tabs)?.path ?? null);
  }

  function renderTabs(): void {
    tabBar.render(tabs);
  }

  function bindSplitPreviewScroll(): void {
    if (splitPreview && view) splitPreview.bindSourceScroller(view.scrollDOM);
  }

  function syncSplitPreview(text = activeText()): void {
    splitPreview?.update(text);
  }

  function applySplitLayout(): void {
    editorHost.style.display = "grid";
    editorHost.style.gridTemplateColumns = `minmax(96px, ${splitSourceRatio.toFixed(3)}fr) 6px minmax(96px, ${(1 - splitSourceRatio).toFixed(3)}fr)`;
    editorHost.style.minWidth = "0";
    editorHost.style.minHeight = "0";
  }

  function setSplitRatio(ratio: number): void {
    splitSourceRatio = clamp(ratio, 0.12, 0.88);
    if (editorMode === "split") applySplitLayout();
  }

  function splitRatio(): number {
    return splitSourceRatio;
  }

  function clearSplitLayout(): void {
    splitResizerCleanup?.();
    splitResizerCleanup = null;
    editorHost.style.display = "";
    editorHost.style.gridTemplateColumns = "";
    editorHost.style.minWidth = "";
    editorHost.style.minHeight = "";
  }

  function mountLocalSplitResizer(handle: HTMLElement): () => void {
    let dragging = false;
    let moved = false;

    const removeDragListeners = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerDone);
      handle.removeEventListener("pointercancel", onPointerDone);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const rect = editorHost.getBoundingClientRect();
      if (rect.width <= 0) return;
      moved = true;
      splitSourceRatio = clamp((event.clientX - rect.left) / rect.width, 0.12, 0.88);
      applySplitLayout();
    };

    const onPointerDone = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(event.pointerId);
      removeDragListeners();
      if (moved) options.onSplitRatioChange?.(splitSourceRatio);
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragging = true;
      moved = false;
      handle.setPointerCapture?.(event.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerDone);
      handle.addEventListener("pointercancel", onPointerDone);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    return () => {
      dragging = false;
      removeDragListeners();
      handle.removeEventListener("pointerdown", onPointerDown);
    };
  }

  function rebuildEditorLayout(): void {
    clearSplitLayout();
    splitPreview?.destroy();
    splitPreview = null;

    editorHost.className = editorMode === "split" ? "pane-editor editor-split" : "pane-editor";
    editorHost.replaceChildren();

    sourceHost = document.createElement("div");
    sourceHost.className = editorMode === "split" ? "editor-pane split-source" : "editor-pane";
    editorHost.appendChild(sourceHost);
    if (view) sourceHost.appendChild(view.dom);

    if (editorMode === "split") {
      applySplitLayout();
      const resizer = document.createElement("div");
      resizer.className = "split-resizer";
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", "vertical");
      resizer.setAttribute("aria-label", "Resize split preview");
      resizer.style.cursor = "col-resize";
      resizer.style.minWidth = "0";
      resizer.style.minHeight = "0";
      editorHost.appendChild(resizer);
      splitResizerCleanup = mountLocalSplitResizer(resizer);
      splitPreview = mountSplitPreview(editorHost);
      bindSplitPreviewScroll();
      syncSplitPreview();
    }
  }

  function stashActiveState(): void {
    if (!tabs.activeId || !view) return;
    const activeId = tabs.activeId;
    tabs = updateActiveText(tabs, view.state.doc.toString());
    states.set(activeId, view.state);
  }

  function showActive(): void {
    const tab = activeTab(tabs);
    if (!tab || !view) return;

    let state = states.get(tab.id);
    if (!state) {
      state = createState(tab.currentText);
      states.set(tab.id, state);
    }
    view.setState(state);
    bindSplitPreviewScroll();
    syncSplitPreview();
    renderTabs();
  }

  function onChange(text: string): void {
    const activeId = tabs.activeId;
    if (!activeId) return;
    tabs = updateActiveText(tabs, text);
    if (view) states.set(activeId, view.state);
    scheduleAutosave(activeId);
    syncSplitPreview(text);
    renderTabs();
    options.onDirtyChange(id);
  }

  function clearAutosave(tabId: string): void {
    const timer = autosaveTimers.get(tabId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    autosaveTimers.delete(tabId);
  }

  function scheduleAutosave(tabId: string): void {
    clearAutosave(tabId);
    const timer = window.setTimeout(() => {
      autosaveTimers.delete(tabId);
      void saveTabIfDirty(tabId);
    }, 800);
    autosaveTimers.set(tabId, timer);
  }

  function clearAllAutosaves(): void {
    for (const timer of autosaveTimers.values()) window.clearTimeout(timer);
    autosaveTimers.clear();
  }

  async function enqueueTabSave<T>(tabId: string, task: () => Promise<T>): Promise<T> {
    const previous = saveQueues.get(tabId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(() => gate);
    saveQueues.set(tabId, next);

    if (previous) await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (saveQueues.get(tabId) === next) saveQueues.delete(tabId);
    }
  }

  async function openPath(path: string): Promise<boolean> {
    const existing = tabs.tabs.find((tab) => tab.path === path);
    if (existing) {
      switchTo(existing.id);
      return true;
    }

    const result = await options.readFile(path);
    if (result.status === "error") {
      console.error(result.error);
      options.onReadError?.(result.error);
      return false;
    }

    stashActiveState();
    if (hasOnlyCleanUntitledTab()) {
      states.delete(tabs.tabs[0].id);
      tabs = emptyTabs();
    }
    tabs = openOrFocus(tabs, path, result.data);
    showActive();
    options.onDirtyChange(id);
    options.onRequestSaveSettings();
    return true;
  }

  function newDoc(): void {
    stashActiveState();
    tabs = newUntitled(tabs);
    showActive();
    options.onDirtyChange(id);
    options.onRequestSaveSettings();
  }

  function switchTo(tabId: string): void {
    if (tabs.activeId === tabId) return;
    if (!tabs.tabs.some((tab) => tab.id === tabId)) return;

    stashActiveState();
    tabs = setActive(tabs, tabId);
    showActive();
    options.onActiveChange(id);
    options.onRequestSaveSettings();
  }

  function closeTab(tabId: string): void {
    if (tabs.activeId === tabId) stashActiveState();
    const closing = tabs.tabs.find((tab) => tab.id === tabId);
    if (!closing) return;
    if (tabDirty(closing) && !canCloseDirtyTab(tabId)) return;

    if (tabs.activeId !== tabId) stashActiveState();
    clearAutosave(tabId);
    states.delete(tabId);
    tabs = closeTabModel(tabs, tabId);
    if (!tabs.activeId) {
      if (options.onEmptyPane?.(id)) return;
      tabs = newUntitled(tabs);
    }
    showActive();
    options.onDirtyChange(id);
    options.onRequestSaveSettings();
  }

  function closeOtherTabs(keepId: string): void {
    for (const tab of [...tabs.tabs]) {
      if (tab.id !== keepId) closeTab(tab.id);
    }
  }

  function tabsSnapshot(): { openTabs: string[]; activePath: string | null } {
    const openTabs = tabs.tabs
      .map((tab) => tab.path)
      .filter((path): path is string => path !== null);
    return { openTabs, activePath: activePath() };
  }

  function setEditorMode(mode: EditorMode): void {
    if (editorMode === mode) return;

    stashActiveState();
    const text = activeTab(tabs)?.currentText ?? activeText();
    editorMode = mode;
    states.clear();

    const tab = activeTab(tabs);
    const state = createState(text);
    if (tab) states.set(tab.id, state);
    currentView().setState(state);
    rebuildEditorLayout();
    renderTabs();
    options.onDirtyChange(id);
  }

  function canCloseDirtyTab(tabId: string): boolean {
    if (options.canCloseDirtyTab) return options.canCloseDirtyTab(id, tabId);
    const confirmClose = window.confirm;
    if (typeof confirmClose !== "function") return false;
    return confirmClose("Close unsaved tab?");
  }

  async function saveDirtyUntilClean(tabId: string): Promise<void> {
    while (true) {
      const tab = tabs.tabs.find((candidate) => candidate.id === tabId);
      if (!tab?.path || !tabDirty(tab)) return;

      const path = tab.path;
      const text = tab.currentText;
      const result = await options.writeFile(path, text);
      if (result.status === "error") {
        console.error(result.error);
        options.onSaveError?.(result.error);
        return;
      }

      const saved = markTabSavedById(tabs, tabId, path, text);
      if (saved.updated) {
        tabs = saved.state;
        renderTabs();
        options.onDirtyChange(id);
        options.onRequestSaveSettings();
      }
    }
  }

  async function saveTabIfDirty(tabId: string): Promise<void> {
    clearAutosave(tabId);
    await enqueueTabSave(tabId, () => saveDirtyUntilClean(tabId));
  }

  async function saveActive(): Promise<void> {
    const activeId = tabs.activeId;
    if (!activeId) return;
    stashActiveState();
    await saveTabIfDirty(activeId);
  }

  async function saveActiveAs(path: string): Promise<CommandResult<null> | CommandError | null> {
    const activeId = tabs.activeId;
    if (!activeId) return null;
    stashActiveState();
    const tab = activeTab(tabs);
    if (!tab) return null;
    clearAutosave(activeId);

    const originalPath = tab.path;
    const text = tab.currentText;
    return enqueueTabSave(activeId, async () => {
      const current = tabs.tabs.find((candidate) => candidate.id === activeId);
      if (!current || current.path !== originalPath) return null;

      const result = await options.writeFile(path, text);
      if (result.status === "error") {
        console.error(result.error);
        options.onSaveError?.(result.error);
        return result;
      }

      const saved = markTabSavedAsById(tabs, activeId, originalPath, path, text);
      if (saved.updated) {
        tabs = saved.state;
        renderTabs();
        options.onDirtyChange(id);
        options.onRequestSaveSettings();
        await saveDirtyUntilClean(activeId);
      }
      return result;
    });
  }

  function replaceActiveText(text: string, replaceOptions: { markSaved?: boolean } = {}): void {
    const activeId = tabs.activeId;
    if (!activeId || !view) return;
    const tab = activeTab(tabs);
    if (!tab) return;

    const nextTab = {
      ...tab,
      currentText: text,
      savedText: replaceOptions.markSaved ? text : tab.savedText,
    };
    tabs = {
      ...tabs,
      tabs: tabs.tabs.map((candidate) => (candidate.id === activeId ? nextTab : candidate)),
    };
    const state = createState(text);
    states.set(activeId, state);
    view.setState(state);
    if (replaceOptions.markSaved) clearAutosave(activeId);
    bindSplitPreviewScroll();
    syncSplitPreview(text);
    renderTabs();
    options.onDirtyChange(id);
    options.onRequestSaveSettings();
  }

  async function flushSaves(): Promise<void> {
    const tabIds = tabs.tabs.map((tab) => tab.id);
    for (const tabId of tabIds) clearAutosave(tabId);
    await Promise.all(tabIds.map((tabId) => saveTabIfDirty(tabId)));
  }

  function destroy(): void {
    clearAllAutosaves();
    splitResizerCleanup?.();
    splitResizerCleanup = null;
    splitPreview?.destroy();
    splitPreview = null;
    view?.destroy();
    root.remove();
  }

  rebuildEditorLayout();
  const initialText = activeTab(tabs)?.currentText ?? "";
  view = createEditorView(sourceHost, createState(initialText));
  view.dom.addEventListener("focusin", () => options.onActiveChange(id));
  if (tabs.activeId) states.set(tabs.activeId, view.state);
  bindSplitPreviewScroll();
  syncSplitPreview();
  renderTabs();

  return {
    id,
    root,
    get view() {
      return currentView();
    },
    openPath,
    newDoc,
    switchTo,
    closeTab,
    closeOtherTabs,
    activeTabId,
    nextTabId() {
      return nextTabIdModel(tabs);
    },
    prevTabId() {
      return prevTabIdModel(tabs);
    },
    nthTabId(n) {
      return nthTabIdModel(tabs, n);
    },
    tabInfo,
    activePath,
    activeText,
    activeDirty,
    tabsSnapshot,
    setEditorMode,
    saveActive,
    saveActiveAs,
    replaceActiveText,
    flushSaves,
    setSplitRatio,
    splitRatio,
    destroy,
  };
}
