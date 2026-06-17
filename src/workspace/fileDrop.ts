import { firstMarkdownPath } from "./dropTargets";
import type { SplitDirection } from "./paneLayout";

export type ResolvedDropTarget =
  | { kind: "tabbar"; paneId: string }
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; direction: SplitDirection; side: "before" | "after" }
  | { kind: "none"; paneId: null };

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
