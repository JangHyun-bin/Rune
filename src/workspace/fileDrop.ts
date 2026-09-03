import { firstMarkdownPath } from "./dropTargets";
import type { SplitDirection } from "./paneLayout";
import type { TabDragPayload } from "./tabBar";

export type ResolvedDropTarget =
  | { kind: "tabbar"; paneId: string }
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; direction: SplitDirection; side: "before" | "after" }
  | { kind: "none"; paneId: null };

export function createNativeFileOpenQueue(openPath: (path: string) => Promise<boolean>) {
  let tail: Promise<unknown> = Promise.resolve();
  let releaseLaunch!: () => void;
  // Hold live events until all paths drained by takeLaunchFile() are ahead of them.
  const launchQueued = new Promise<void>((resolve) => { releaseLaunch = resolve; });
  const enqueue = (path: string) => {
    const opened = tail.then(() => openPath(path));
    tail = opened.catch(() => {});
    return opened;
  };
  return {
    drainLaunchFiles: (paths: string[]) => {
      const drained = Promise.all(paths.map(enqueue));
      releaseLaunch();
      return drained;
    },
    openLiveFile: (path: string) => launchQueued.then(() => enqueue(path)),
  };
}

export async function handleNativeFileDrop(args: {
  paths: string[];
  target: ResolvedDropTarget;
  openInPane: (paneId: string, path: string) => Promise<boolean | void>;
  splitInPane: (
    paneId: string,
    path: string,
    direction: SplitDirection,
    side: "before" | "after",
  ) => Promise<string | null | boolean | void>;
}): Promise<boolean> {
  const path = firstMarkdownPath(args.paths);
  if (!path || args.target.kind === "none") return false;

  if (args.target.kind === "pane-edge") {
    const result = await args.splitInPane(args.target.paneId, path, args.target.direction, args.target.side);
    return result !== false && result !== null;
  }

  const result = await args.openInPane(args.target.paneId, path);
  return result !== false;
}

/** Dragging an already-open tab onto a pane edge (split) or a different pane's
 * center (move) — mirrors handleNativeFileDrop's shape but for in-app drags,
 * where the payload already carries a real path and a duplicate flag (Ctrl/Cmd
 * held at drag start keeps the source tab instead of closing it). */
export async function handleInternalTabDrop(args: {
  payload: TabDragPayload;
  target: ResolvedDropTarget;
  openInPane: (paneId: string, path: string) => Promise<boolean | void>;
  splitInPane: (
    paneId: string,
    path: string,
    direction: SplitDirection,
    side: "before" | "after",
  ) => Promise<string | null | boolean | void>;
  closeTab: (paneId: string, tabId: string) => void;
}): Promise<boolean> {
  const { payload, target } = args;
  if (!payload.path) return false;

  if (target.kind === "pane-edge") {
    const result = await args.splitInPane(target.paneId, payload.path, target.direction, target.side);
    if (result === false || result === null) return false;
  } else if (target.kind === "pane-center" && target.paneId !== payload.paneId) {
    const result = await args.openInPane(target.paneId, payload.path);
    if (result === false) return false;
  } else {
    return false;
  }

  if (!payload.duplicate) args.closeTab(payload.paneId, payload.tabId);
  return true;
}
