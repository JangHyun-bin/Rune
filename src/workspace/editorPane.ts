import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editorState, createEditorView, type EditorMode } from "../editor/editor";
import { mountSplitPreview, type SplitPreview } from "../editor/splitPreview";
import { autosave } from "./autosave";
import { mountTabBar } from "./tabBar";
import {
  activeTab,
  closeTab as closeTabModel,
  emptyTabs,
  markActiveSaved,
  newUntitled,
  openOrFocus,
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
  readFile: (path: string) => Promise<CommandResult<string> | CommandError>;
  writeFile: (path: string, contents: string) => Promise<CommandResult<null> | CommandError>;
  onActiveChange: (paneId: string) => void;
  onDirtyChange: (paneId: string) => void;
  onRequestSaveSettings: () => void;
}

export interface EditorPane {
  id: string;
  root: HTMLElement;
  view: EditorView;
  openPath(path: string): Promise<void>;
  newDoc(): void;
  switchTo(tabId: string): void;
  closeTab(tabId: string): void;
  activePath(): string | null;
  activeText(): string;
  activeDirty(): boolean;
  tabsSnapshot(): { openTabs: string[]; activePath: string | null };
  setEditorMode(mode: EditorMode): void;
  saveActive(): Promise<void>;
  destroy(): void;
}

type AutosaveHandle = ReturnType<typeof autosave> & {
  destroy?: () => void;
  dispose?: () => void;
};

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

  const tabBar = mountTabBar(tabbarHost, {
    paneId: id,
    onSelect: switchTo,
    onClose: closeTab,
    onContextMenu: () => {},
  });
  const auto = autosave(800, () => void saveActive());

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

  function createState(doc: string): EditorState {
    const extensions: Extension[] = [auto.ext];
    return editorState(doc, onChange, extensions, editorMode, () => activeTab(tabs)?.path ?? null);
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

  function rebuildEditorLayout(): void {
    splitPreview?.destroy();
    splitPreview = null;

    editorHost.className = editorMode === "split" ? "pane-editor editor-split" : "pane-editor";
    editorHost.replaceChildren();

    sourceHost = document.createElement("div");
    sourceHost.className = editorMode === "split" ? "editor-pane split-source" : "editor-pane";
    editorHost.appendChild(sourceHost);
    if (view) sourceHost.appendChild(view.dom);

    if (editorMode === "split") {
      const resizer = document.createElement("div");
      resizer.className = "split-resizer";
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", "vertical");
      resizer.setAttribute("aria-label", "Resize split preview");
      editorHost.appendChild(resizer);
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
    tabs = updateActiveText(tabs, text);
    if (tabs.activeId && view) states.set(tabs.activeId, view.state);
    syncSplitPreview(text);
    renderTabs();
    options.onDirtyChange(id);
  }

  async function openPath(path: string): Promise<void> {
    const existing = tabs.tabs.find((tab) => tab.path === path);
    if (existing) {
      switchTo(existing.id);
      return;
    }

    const result = await options.readFile(path);
    if (result.status === "error") {
      console.error(result.error);
      return;
    }

    stashActiveState();
    tabs = openOrFocus(tabs, path, result.data);
    showActive();
    options.onRequestSaveSettings();
  }

  function newDoc(): void {
    stashActiveState();
    tabs = newUntitled(tabs);
    showActive();
    options.onRequestSaveSettings();
  }

  function switchTo(tabId: string): void {
    if (tabs.activeId === tabId) return;
    if (!tabs.tabs.some((tab) => tab.id === tabId)) return;

    stashActiveState();
    tabs = setActive(tabs, tabId);
    showActive();
    options.onRequestSaveSettings();
  }

  function closeTab(tabId: string): void {
    const closing = tabs.tabs.find((tab) => tab.id === tabId);
    if (!closing) return;

    if (tabs.activeId !== tabId) stashActiveState();
    states.delete(tabId);
    tabs = closeTabModel(tabs, tabId);
    if (!tabs.activeId) tabs = newUntitled(tabs);
    showActive();
    options.onRequestSaveSettings();
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
  }

  async function saveActive(): Promise<void> {
    const tab = activeTab(tabs);
    if (!tab?.path || !view) return;

    const text = view.state.doc.toString();
    const result = await options.writeFile(tab.path, text);
    if (result.status === "error") {
      console.error(result.error);
      return;
    }

    tabs = markActiveSaved(tabs, tab.path, text);
    states.set(tab.id, view.state);
    renderTabs();
    options.onDirtyChange(id);
    options.onRequestSaveSettings();
  }

  function destroyAutosave(): void {
    const disposable = auto as AutosaveHandle;
    disposable.destroy?.();
    disposable.dispose?.();
  }

  function destroy(): void {
    splitPreview?.destroy();
    splitPreview = null;
    view?.destroy();
    destroyAutosave();
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
    activePath,
    activeText,
    activeDirty,
    tabsSnapshot,
    setEditorMode,
    saveActive,
    destroy,
  };
}
