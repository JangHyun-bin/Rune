import type { EditorMode } from "../editor/editor";
import type { Extension } from "@codemirror/state";
import { createEditorPane, type EditorPane, type EditorPaneOptions } from "./editorPane";
import {
  createSinglePaneLayout,
  flattenPaneIds,
  splitPane,
  type LayoutNode,
  type PaneId,
  type SplitDirection,
} from "./paneLayout";
import type { PaneWorkspaceSnapshot } from "./panePersistence";

export interface PaneWorkspaceOptions {
  host: HTMLElement;
  editorMode: EditorMode;
  extraExtensions?: () => Extension[];
  initialSplitRatio?: number;
  readFile: EditorPaneOptions["readFile"];
  writeFile: EditorPaneOptions["writeFile"];
  onActivePaneChange: (paneId: PaneId) => void;
  onActiveDocumentChange: () => void;
  onRequestSaveSettings: () => void;
  onReadError?: (message: string) => void;
  onSaveError?: (message: string) => void;
  onSplitRatioChange?: (ratio: number) => void;
  onTabContextMenu?: (paneId: PaneId, tabId: string, x: number, y: number) => void;
  canCloseDirtyTab?: (paneId: PaneId, tabId: string) => boolean;
}

export interface PaneWorkspace {
  activePane(): EditorPane;
  openPathInActivePane(path: string): Promise<boolean>;
  openPathInPane(paneId: PaneId, path: string): Promise<boolean>;
  splitActivePaneAndOpen(
    path: string,
    direction: SplitDirection,
    side: "before" | "after",
  ): Promise<PaneId | null>;
  splitPaneAndOpen(
    paneId: PaneId,
    path: string,
    direction: SplitDirection,
    side: "before" | "after",
  ): Promise<PaneId | null>;
  setActivePane(paneId: PaneId): void;
  setEditorMode(mode: EditorMode): void;
  flushSaves(): Promise<void>;
  setSplitRatio(ratio: number): void;
  splitRatio(): number;
  snapshot(): PaneWorkspaceSnapshot;
  destroy(): void;
}

const INITIAL_PANE_ID = "pane-1";

function cloneLayoutNode(node: LayoutNode): LayoutNode {
  if (node.type === "pane") return { type: "pane", paneId: node.paneId };
  return {
    type: "split",
    direction: node.direction,
    ratios: [...node.ratios],
    children: node.children.map(cloneLayoutNode),
  };
}

function assertPane(panes: Map<PaneId, EditorPane>, paneId: PaneId): EditorPane {
  const pane = panes.get(paneId);
  if (!pane) throw new Error(`Unknown pane: ${paneId}`);
  return pane;
}

function assignPaneId(element: HTMLElement, paneId: PaneId): void {
  element.dataset.paneId = paneId;
  element.setAttribute("data-pane-id", paneId);
}

function setTokenClass(element: HTMLElement, token: string, enabled: boolean): void {
  const tokens = element.className.split(/\s+/).filter((value) => value.length > 0 && value !== token);
  if (enabled) tokens.push(token);
  element.className = tokens.join(" ");
}

function gridTracks(ratios: number[], count: number): string {
  return Array.from({ length: count }, (_, index) => `${ratios[index] ?? 1}fr`).join(" ");
}

export function createPaneWorkspace(options: PaneWorkspaceOptions): PaneWorkspace {
  const panes = new Map<PaneId, EditorPane>();
  let root: LayoutNode = createSinglePaneLayout(INITIAL_PANE_ID);
  let activePaneId: PaneId = INITIAL_PANE_ID;
  let editorMode = options.editorMode;
  let nextPaneNumber = 2;

  options.host.className = "pane-workspace";

  function markActivePane(): void {
    for (const pane of panes.values()) {
      assignPaneId(pane.root, pane.id);
      setTokenClass(pane.root, "active", pane.id === activePaneId);
    }
  }

  function createPane(paneId: PaneId, host: HTMLElement = options.host): EditorPane {
    const pane = createEditorPane({
      id: paneId,
      host,
      editorMode,
      extraExtensions: options.extraExtensions,
      initialSplitRatio: options.initialSplitRatio,
      readFile: options.readFile,
      writeFile: options.writeFile,
      onActiveChange: (id) => {
        setActivePane(id);
      },
      onDirtyChange: () => options.onActiveDocumentChange(),
      onRequestSaveSettings: options.onRequestSaveSettings,
      onReadError: options.onReadError,
      onSaveError: options.onSaveError,
      onSplitRatioChange: options.onSplitRatioChange,
      onTabContextMenu: options.onTabContextMenu,
      canCloseDirtyTab: options.canCloseDirtyTab,
    });
    assignPaneId(pane.root, paneId);
    panes.set(paneId, pane);
    return pane;
  }

  function renderNode(node: LayoutNode): HTMLElement {
    if (node.type === "pane") {
      return assertPane(panes, node.paneId).root;
    }

    const split = document.createElement("div");
    split.className = "pane-split";
    split.dataset.direction = node.direction;
    split.setAttribute("data-direction", node.direction);
    split.style.display = "grid";
    split.style.minWidth = "0";
    split.style.minHeight = "0";
    if (node.direction === "row") {
      split.style.gridTemplateColumns = gridTracks(node.ratios, node.children.length);
      split.style.gridTemplateRows = "";
    } else {
      split.style.gridTemplateColumns = "";
      split.style.gridTemplateRows = gridTracks(node.ratios, node.children.length);
    }

    for (const child of node.children) {
      split.appendChild(renderNode(child));
    }
    return split;
  }

  function render(): void {
    options.host.replaceChildren(renderNode(root));
    markActivePane();
  }

  function newPaneId(): PaneId {
    const paneId = `pane-${nextPaneNumber}`;
    nextPaneNumber += 1;
    return paneId;
  }

  function restoreNextPaneNumber(value: number): void {
    nextPaneNumber = value;
  }

  function setActivePane(paneId: PaneId): void {
    assertPane(panes, paneId);
    activePaneId = paneId;
    markActivePane();
    options.onActivePaneChange(paneId);
  }

  async function tryOpenPath(pane: EditorPane, path: string): Promise<boolean> {
    try {
      return await pane.openPath(path);
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async function openPathInPane(paneId: PaneId, path: string): Promise<boolean> {
    const pane = assertPane(panes, paneId);
    const opened = await tryOpenPath(pane, path);
    if (!opened) return false;
    setActivePane(paneId);
    options.onActiveDocumentChange();
    options.onRequestSaveSettings();
    return true;
  }

  async function splitPaneAndOpen(
    paneId: PaneId,
    path: string,
    direction: SplitDirection,
    side: "before" | "after",
  ): Promise<PaneId | null> {
    assertPane(panes, paneId);
    const previousNextPaneNumber = nextPaneNumber;
    const newId = newPaneId();
    const stagingHost = document.createElement("div");
    const pane = createPane(newId, stagingHost);
    const opened = await tryOpenPath(pane, path);
    if (!opened) {
      pane.destroy();
      panes.delete(newId);
      restoreNextPaneNumber(previousNextPaneNumber);
      return null;
    }

    root = splitPane(root, { sourcePaneId: paneId, direction, side, newPaneId: newId });
    render();
    setActivePane(newId);
    options.onActiveDocumentChange();
    options.onRequestSaveSettings();
    return newId;
  }

  function setEditorMode(mode: EditorMode): void {
    editorMode = mode;
    for (const pane of panes.values()) pane.setEditorMode(mode);
  }

  async function flushSaves(): Promise<void> {
    await Promise.all([...panes.values()].map((pane) => pane.flushSaves()));
  }

  function setSplitRatio(ratio: number): void {
    for (const pane of panes.values()) pane.setSplitRatio(ratio);
  }

  function splitRatio(): number {
    return assertPane(panes, activePaneId).splitRatio();
  }

  function snapshot(): PaneWorkspaceSnapshot {
    return {
      version: 1,
      root: cloneLayoutNode(root),
      activePaneId,
      panes: flattenPaneIds(root).map((paneId) => {
        const pane = assertPane(panes, paneId);
        return { id: paneId, ...pane.tabsSnapshot() };
      }),
    };
  }

  function destroy(): void {
    for (const pane of panes.values()) pane.destroy();
    panes.clear();
    options.host.replaceChildren();
  }

  createPane(INITIAL_PANE_ID);
  render();

  return {
    activePane() {
      return assertPane(panes, activePaneId);
    },
    openPathInActivePane(path) {
      return openPathInPane(activePaneId, path);
    },
    openPathInPane,
    splitActivePaneAndOpen(path, direction, side) {
      return splitPaneAndOpen(activePaneId, path, direction, side);
    },
    splitPaneAndOpen,
    setActivePane,
    setEditorMode,
    flushSaves,
    setSplitRatio,
    splitRatio,
    snapshot,
    destroy,
  };
}
