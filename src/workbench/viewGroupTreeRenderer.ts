import type { ViewGroupLayoutNode } from "./viewGroupLayout";

/** Shared structural renderer for main and detached Workbench group trees. */
export function renderViewGroupTree(
  node: ViewGroupLayoutNode,
  renderGroup: (groupId: string) => HTMLElement,
): HTMLElement {
  if (node.type === "group") return renderGroup(node.groupId);
  const split = document.createElement("div");
  split.className = "view-group-split";
  split.dataset.direction = node.direction;
  node.children.forEach((child, index) => {
    const element = renderViewGroupTree(child, renderGroup);
    element.style.setProperty("--view-group-ratio", String(node.ratios[index] ?? 1));
    split.appendChild(element);
  });
  return split;
}
