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

const EDGE_MIN = 56;
const EDGE_MAX = 420;
const CENTER_MIN = 96;
const HYSTERESIS = 1.14;

export interface DropZoneOptions {
  previous?: PaneDropZone | null;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function firstMarkdownPath(paths: string[]): string | null {
  return paths.find(isMarkdownPath) ?? null;
}

export function physicalToCssPoint(position: Point, deviceScaleFactor = 1): Point {
  const scale = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1;
  return { x: position.x / scale, y: position.y / scale };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function adaptiveEdgeRatio(length: number): number {
  const t = clamp((length - 320) / 720, 0, 1);
  return 0.3 + t * 0.1;
}

export function adaptiveDropEdgeSize(length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const adaptive = length * adaptiveEdgeRatio(length);
  const centerMin = Math.min(CENTER_MIN, length * 0.34);
  const maxEdge = Math.max(0, Math.min(EDGE_MAX, (length - centerMin) / 2));
  const minEdge = Math.min(EDGE_MIN, maxEdge);
  return clamp(adaptive, minEdge, maxEdge);
}

function distanceToEdge(rect: RectLike, point: Point, zone: Extract<PaneDropZone, { kind: "pane-edge" }>): number {
  if (zone.direction === "row") {
    return zone.side === "before"
      ? point.x - rect.left
      : rect.left + rect.width - point.x;
  }
  return zone.side === "before"
    ? point.y - rect.top
    : rect.top + rect.height - point.y;
}

function edgeLength(rect: RectLike, direction: SplitDirection): number {
  return direction === "row" ? rect.width : rect.height;
}

function stickyPrevious(
  rect: RectLike,
  point: Point,
  previous: PaneDropZone | null | undefined,
): PaneDropZone | null {
  if (!previous || previous.kind !== "pane-edge") return null;
  const size = adaptiveDropEdgeSize(edgeLength(rect, previous.direction)) * HYSTERESIS;
  const distance = distanceToEdge(rect, point, previous);
  return distance >= 0 && distance <= size ? previous : null;
}

export function hitPaneDropZone(rect: RectLike, point: Point, options: DropZoneOptions = {}): PaneDropZone {
  const sticky = stickyPrevious(rect, point, options.previous);
  if (sticky) return sticky;

  const horizontalEdge = adaptiveDropEdgeSize(rect.width);
  const verticalEdge = adaptiveDropEdgeSize(rect.height);
  type EdgeZone = Extract<PaneDropZone, { kind: "pane-edge" }>;
  const rawCandidates: Array<{ zone: EdgeZone; score: number }> = [
    { zone: { kind: "pane-edge", direction: "row", side: "before" }, score: (point.x - rect.left) / horizontalEdge },
    { zone: { kind: "pane-edge", direction: "row", side: "after" }, score: (rect.left + rect.width - point.x) / horizontalEdge },
    { zone: { kind: "pane-edge", direction: "column", side: "before" }, score: (point.y - rect.top) / verticalEdge },
    { zone: { kind: "pane-edge", direction: "column", side: "after" }, score: (rect.top + rect.height - point.y) / verticalEdge },
  ];
  const candidates = rawCandidates.filter((candidate) =>
    Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1);

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.zone ?? { kind: "pane-center" };
}

export function dropZoneRect(rect: RectLike, zone: PaneDropZone): RectLike {
  const horizontalEdge = adaptiveDropEdgeSize(rect.width);
  const verticalEdge = adaptiveDropEdgeSize(rect.height);
  if (zone.kind === "pane-center") {
    return {
      left: rect.left + horizontalEdge,
      top: rect.top + verticalEdge,
      width: Math.max(1, rect.width - horizontalEdge * 2),
      height: Math.max(1, rect.height - verticalEdge * 2),
    };
  }

  if (zone.direction === "row") {
    const width = horizontalEdge;
    return {
      left: zone.side === "after" ? rect.left + rect.width - width : rect.left,
      top: rect.top,
      width,
      height: rect.height,
    };
  }

  const height = verticalEdge;
  return {
    left: rect.left,
    top: zone.side === "after" ? rect.top + rect.height - height : rect.top,
    width: rect.width,
    height,
  };
}
