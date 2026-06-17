import type { SplitDirection } from "./paneLayout";

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PaneDropZone =
  | { kind: "pane-edge"; direction: SplitDirection; side: "before" | "after" }
  | { kind: "pane-center" };

const EDGE_RATIO = 0.22;
const EDGE_MIN = 42;
const EDGE_MAX = 96;

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function firstMarkdownPath(paths: string[]): string | null {
  return paths.find(isMarkdownPath) ?? null;
}

export function physicalToCssPoint(position: Point, deviceScaleFactor = window.devicePixelRatio || 1): Point {
  const scale = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1;
  return { x: position.x / scale, y: position.y / scale };
}

function edgeSize(length: number): number {
  return Math.min(EDGE_MAX, Math.max(EDGE_MIN, length * EDGE_RATIO));
}

export function hitPaneDropZone(rect: RectLike, point: Point): PaneDropZone {
  const leftEdge = edgeSize(rect.width);
  const topEdge = edgeSize(rect.height);
  const relX = point.x - rect.left;
  const relY = point.y - rect.top;

  if (relX <= leftEdge) return { kind: "pane-edge", direction: "row", side: "before" };
  if (relX >= rect.width - leftEdge) return { kind: "pane-edge", direction: "row", side: "after" };
  if (relY <= topEdge) return { kind: "pane-edge", direction: "column", side: "before" };
  if (relY >= rect.height - topEdge) return { kind: "pane-edge", direction: "column", side: "after" };
  return { kind: "pane-center" };
}
