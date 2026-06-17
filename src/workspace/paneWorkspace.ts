import type { EditorMode } from "../editor/editor";
import type { Extension } from "@codemirror/state";
import { createEditorPane, type EditorPane, type EditorPaneOptions } from "./editorPane";
import {
  createSinglePaneLayout,
  flattenPaneIds,
  removePane,
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
  restore(snapshot: PaneWorkspaceSnapshot): Promise<void>;
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

function gridTracksWithResizers(ratios: number[], count: number): string {
  const tracks: string[] = [];
  for (let index = 0; index < count; index++) {
    if (index > 0) tracks.push("6px");
    tracks.push(`${ratios[index] ?? 1}fr`);
  }
  return tracks.join(" ");
}

function nextPaneNumberAfter(paneIds: PaneId[]): number {
  let maxPaneNumber = 1;
  for (const paneId of paneIds) {
    const match = /^pane-(\d+)$/.exec(paneId);
    if (!match) continue;
    maxPaneNumber = Math.max(maxPaneNumber, Number(match[1]));
  }
  return maxPaneNumber + 1;
}

export function createPaneWorkspace(options: PaneWorkspaceOptions): PaneWorkspace {
  const panes = new Map<PaneId, EditorPane>();
  let root: LayoutNode = createSinglePaneLayout(INITIAL_PANE_ID);
  let activePaneId: PaneId = INITIAL_PANE_ID;
  let editorMode = options.editorMode;
  let nextPaneNumber = 2;
  let restoring = false;

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
        if (restoring) return;
        setActivePane(id);
      },
      onDirtyChange: () => {
        if (!restoring) options.onActiveDocumentChange();
      },
      onRequestSaveSettings: () => {
        if (!restoring) options.onRequestSaveSettings();
      },
      onReadError: options.onReadError,
      onSaveError: options.onSaveError,
      onSplitRatioChange: options.onSplitRatioChange,
      onTabContextMenu: options.onTabContextMenu,
      canCloseDirtyTab: options.canCloseDirtyTab,
      onEmptyPane: removePaneIfAllowed,
    });
    assignPaneId(pane.root, paneId);
    panes.set(paneId, pane);
    return pane;
  }

  function removePaneIfAllowed(paneId: PaneId): boolean {
    const paneIds = flattenPaneIds(root);
    if (paneIds.length <= 1 || !paneIds.includes(paneId)) return false;
    const nextRoot = removePane(root, paneId);
    if (!nextRoot) return false;

    const removedIndex = paneIds.indexOf(paneId);
    const nextActivePaneId = paneIds[removedIndex + 1] ?? paneIds[removedIndex - 1] ?? paneIds[0];
    const pane = panes.get(paneId);
    pane?.destroy();
    panes.delete(paneId);
    root = nextRoot;
    activePaneId = nextActivePaneId === paneId ? flattenPaneIds(root)[0] : nextActivePaneId;
    render();
    setActivePane(activePaneId);
    options.onActiveDocumentChange();
    options.onRequestSaveSettings();
    return true;
  }

  function mountSplitResizer(
    split: HTMLElement,
    node: Extract<LayoutNode, { type: "split" }>,
    index: number,
  ): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "pane-split-resizer";
    handle.dataset.direction = node.direction;
    handle.setAttribute("data-direction", node.direction);
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", node.direction === "row" ? "vertical" : "horizontal");
    handle.setAttribute("aria-label", "Resize editor panes");

    let dragging = false;
    let moved = false;
    let startClient = 0;
    let startRatios: number[] = [];
    let pairSize = 1;
    const minRatio = 0.08;

    const applyRatios = () => {
      if (node.direction === "row") {
        split.style.gridTemplateColumns = gridTracksWithResizers(node.ratios, node.children.length);
      } else {
        split.style.gridTemplateRows = gridTracksWithResizers(node.ratios, node.children.length);
      }
    };

    const removeDragListeners = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerDone);
      handle.removeEventListener("pointercancel", onPointerDone);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const pairTotal = (startRatios[index] ?? 1) + (startRatios[index + 1] ?? 1);
      if (pairTotal <= 0 || pairSize <= 0) return;
      const client = node.direction === "row" ? event.clientX : event.clientY;
      const deltaRatio = ((client - startClient) / pairSize) * pairTotal;
      const maxFirst = Math.max(minRatio, pairTotal - minRatio);
      const first = Math.min(maxFirst, Math.max(minRatio, (startRatios[index] ?? 1) + deltaRatio));
      node.ratios = [...startRatios];
      node.ratios[index] = first;
      node.ratios[index + 1] = pairTotal - first;
      moved = true;
      applyRatios();
    };

    const onPointerDone = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(event.pointerId);
      removeDragListeners();
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-pane-split-row", "resizing-pane-split-column");
      if (moved) options.onRequestSaveSettings();
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      const rect = split.getBoundingClientRect();
      const axisSize = node.direction === "row" ? rect.width : rect.height;
      if (axisSize <= 0) return;

      const totalRatio = node.ratios.reduce((sum, ratio) => sum + ratio, 0);
      const pairTotal = (node.ratios[index] ?? 1) + (node.ratios[index + 1] ?? 1);
      const flexibleSize = Math.max(1, axisSize - Math.max(0, node.children.length - 1) * 6);
      pairSize = Math.max(1, flexibleSize * (pairTotal / Math.max(totalRatio, 0.001)));
      startClient = node.direction === "row" ? event.clientX : event.clientY;
      startRatios = [...node.ratios];
      dragging = true;
      moved = false;
      handle.classList.add("dragging");
      document.body.classList.add(node.direction === "row" ? "resizing-pane-split-row" : "resizing-pane-split-column");
      handle.setPointerCapture?.(event.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerDone);
      handle.addEventListener("pointercancel", onPointerDone);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    return handle;
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
      split.style.gridTemplateColumns = gridTracksWithResizers(node.ratios, node.children.length);
      split.style.gridTemplateRows = "";
    } else {
      split.style.gridTemplateColumns = "";
      split.style.gridTemplateRows = gridTracksWithResizers(node.ratios, node.children.length);
    }

    node.children.forEach((child, index) => {
      if (index > 0) split.appendChild(mountSplitResizer(split, node, index - 1));
      split.appendChild(renderNode(child));
    });
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

  async function restore(snapshot: PaneWorkspaceSnapshot): Promise<void> {
    for (const pane of panes.values()) pane.destroy();
    panes.clear();
    options.host.replaceChildren();

    root = cloneLayoutNode(snapshot.root);
    let paneIds = [...new Set(flattenPaneIds(root))];
    if (paneIds.length === 0) {
      root = createSinglePaneLayout(INITIAL_PANE_ID);
      paneIds = [INITIAL_PANE_ID];
    }
    for (const paneId of paneIds) createPane(paneId);
    nextPaneNumber = nextPaneNumberAfter(paneIds);
    render();

    const paneSnapshots = new Map(snapshot.panes.map((pane) => [pane.id, pane]));
    const targetActivePaneId = paneIds.includes(snapshot.activePaneId)
      ? snapshot.activePaneId
      : paneIds[0];

    restoring = true;
    try {
      for (const paneId of paneIds) {
        const pane = assertPane(panes, paneId);
        const paneSnapshot = paneSnapshots.get(paneId);
        if (!paneSnapshot) continue;

        for (const path of paneSnapshot.openTabs) {
          await tryOpenPath(pane, path);
        }
        if (paneSnapshot.activePath) {
          await tryOpenPath(pane, paneSnapshot.activePath);
        }
      }
    } finally {
      restoring = false;
    }

    setActivePane(targetActivePaneId);
    options.onActiveDocumentChange();
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
    restore,
    destroy,
  };
}
