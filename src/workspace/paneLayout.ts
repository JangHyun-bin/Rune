export type PaneId = string;
export type SplitDirection = "row" | "column";

export type LayoutNode =
  | { type: "pane"; paneId: PaneId }
  | { type: "split"; direction: SplitDirection; children: LayoutNode[]; ratios: number[] };

export interface SplitPaneRequest {
  sourcePaneId: PaneId;
  direction: SplitDirection;
  side: "before" | "after";
  newPaneId: PaneId;
}

export function createSinglePaneLayout(paneId: PaneId): LayoutNode {
  return { type: "pane", paneId };
}

export function flattenPaneIds(node: LayoutNode): PaneId[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(flattenPaneIds);
}

function evenRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeSplit(node: Extract<LayoutNode, { type: "split" }>): LayoutNode {
  const children = node.children.filter(Boolean);
  if (children.length === 1) return children[0];
  return { ...node, children, ratios: evenRatios(children.length) };
}

export function splitPane(node: LayoutNode, request: SplitPaneRequest): LayoutNode {
  if (node.type === "pane") {
    if (node.paneId !== request.sourcePaneId) return node;
    const current: LayoutNode = { type: "pane", paneId: node.paneId };
    const next: LayoutNode = { type: "pane", paneId: request.newPaneId };
    const children = request.side === "before" ? [next, current] : [current, next];
    return { type: "split", direction: request.direction, children, ratios: [0.5, 0.5] };
  }

  const children = node.children.map((child) => splitPane(child, request));
  return normalizeSplit({ ...node, children });
}

export function removePane(node: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (node.type === "pane") return node.paneId === paneId ? null : node;
  const children = node.children
    .map((child) => removePane(child, paneId))
    .filter((child): child is LayoutNode => child !== null);
  if (children.length === 0) return null;
  return normalizeSplit({ ...node, children });
}
