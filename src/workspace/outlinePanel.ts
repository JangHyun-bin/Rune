import { buildOutlineTree, filterOutlineTree, type HeadingItem, type OutlineNode } from "../editor/outline";
import { t } from "../i18n/i18n";

export interface OutlinePanel {
  render(items: HeadingItem[]): void;
  setActiveLine(line: number): void;
  relabel(): void;
  dispose(): void;
}

interface VisibleNode {
  node: OutlineNode;
  depth: number;
}

export function mountOutlinePanel(el: HTMLElement, onJump: (line: number) => void): OutlinePanel {
  let items: HeadingItem[] = [];
  let tree: OutlineNode[] = [];
  let activeLine = 1;
  let filterQuery = "";
  let lastRevealedLine = -1;
  const collapsed = new Set<number>();
  const rowByLine = new Map<number, HTMLButtonElement>();

  el.replaceChildren();
  el.className = "outline-panel";

  const title = document.createElement("div");
  title.className = "outline-title";
  const filter = document.createElement("input");
  filter.className = "outline-filter";
  filter.type = "search";
  const list = document.createElement("div");
  list.className = "outline-list";
  list.setAttribute("role", "tree");
  el.append(title, filter, list);

  function visibleNodes(): VisibleNode[] {
    const result: VisibleNode[] = [];
    const filtered = filterOutlineTree(tree, filterQuery);
    const filtering = filterQuery.trim().length > 0;
    const visit = (nodes: OutlineNode[], depth: number) => {
      for (const node of nodes) {
        result.push({ node, depth });
        if (filtering || !collapsed.has(node.line)) visit(node.children, depth + 1);
      }
    };
    visit(filtered, 1);
    return result;
  }

  function activeHeadingLine(): number {
    return [...items].reverse().find((item) => item.line <= activeLine)?.line ?? -1;
  }

  function visibleActiveLine(visible: Set<number>): number {
    const line = activeHeadingLine();
    return visible.has(line) ? line : -1;
  }

  function focusRow(line: number): void {
    rowByLine.get(line)?.focus();
  }

  function updateActive(reveal: boolean): void {
    const visible = new Set(rowByLine.keys());
    const line = visibleActiveLine(visible);
    for (const [rowLine, row] of rowByLine) {
      row.classList.toggle("active", rowLine === line);
      row.tabIndex = rowLine === line ? 0 : -1;
    }
    if (reveal && line >= 0 && line !== lastRevealedLine) {
      rowByLine.get(line)?.scrollIntoView({ block: "nearest" });
      lastRevealedLine = line;
    }
  }

  function toggleLabel(expanded: boolean): string {
    return t(expanded ? "outline.collapse" : "outline.expand");
  }

  function handleKey(event: KeyboardEvent, entry: VisibleNode, visible: VisibleNode[]): void {
    const index = visible.findIndex(({ node }) => node.line === entry.node.line);
    const filtering = filterQuery.trim().length > 0;
    const expanded = entry.node.children.length > 0 && !collapsed.has(entry.node.line);
    let focusLine: number | null = null;

    if (event.key === "ArrowDown") {
      focusLine = visible[Math.min(index + 1, visible.length - 1)]?.node.line ?? entry.node.line;
    } else if (event.key === "ArrowUp") {
      focusLine = visible[Math.max(index - 1, 0)]?.node.line ?? entry.node.line;
    } else if (event.key === "ArrowLeft" && expanded && !filtering) {
      collapsed.add(entry.node.line);
      draw(entry.node.line);
    } else if (event.key === "ArrowRight" && entry.node.children.length > 0) {
      if (!expanded && !filtering) {
        collapsed.delete(entry.node.line);
        draw(entry.node.line);
      } else {
        focusLine = visible[index + 1]?.node.line ?? null;
      }
    } else {
      return;
    }

    event.preventDefault();
    if (focusLine !== null) focusRow(focusLine);
  }

  function draw(focusLine: number | null = null): void {
    list.replaceChildren();
    rowByLine.clear();
    const visible = visibleNodes();

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = t(items.length === 0 ? "outline.empty" : "outline.noMatches");
      list.appendChild(empty);
      return;
    }

    for (const entry of visible) {
      const { node, depth } = entry;
      const item = document.createElement("div");
      item.className = "outline-item";
      item.style.setProperty("--level", String(depth));

      if (node.children.length > 0) {
        const expanded = filterQuery.trim().length > 0 || !collapsed.has(node.line);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "outline-toggle";
        toggle.tabIndex = -1;
        toggle.textContent = expanded ? "⌄" : "›";
        toggle.setAttribute("aria-label", toggleLabel(expanded));
        toggle.title = toggleLabel(expanded);
        toggle.addEventListener("click", () => {
          if (expanded) collapsed.add(node.line);
          else collapsed.delete(node.line);
          draw(node.line);
        });
        item.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "outline-toggle-spacer";
        item.appendChild(spacer);
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = "outline-row";
      row.textContent = node.text;
      row.title = node.text;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth));
      if (node.children.length > 0) {
        row.setAttribute("aria-expanded", String(filterQuery.trim().length > 0 || !collapsed.has(node.line)));
      }
      row.addEventListener("click", () => onJump(node.line));
      row.addEventListener("keydown", (event) => handleKey(event, entry, visible));
      rowByLine.set(node.line, row);
      item.appendChild(row);
      list.appendChild(item);
    }

    updateActive(true);
    if (focusLine !== null) focusRow(focusLine);
  }

  function relabel(): void {
    title.textContent = t("outline.title");
    filter.placeholder = t("outline.filter");
    filter.setAttribute("aria-label", t("outline.filter"));
    list.setAttribute("aria-label", t("outline.title"));
    draw();
  }

  function sameHeadings(next: HeadingItem[]): boolean {
    return next.length === items.length
      && next.every((item, index) => {
        const current = items[index];
        return item.level === current.level && item.line === current.line && item.text === current.text;
      });
  }

  filter.addEventListener("input", () => {
    filterQuery = filter.value;
    lastRevealedLine = -1;
    draw();
  });

  relabel();

  return {
    render(next) {
      if (sameHeadings(next)) return;
      items = next;
      tree = buildOutlineTree(items);
      const validLines = new Set(items.map((item) => item.line));
      for (const line of collapsed) if (!validLines.has(line)) collapsed.delete(line);
      lastRevealedLine = -1;
      draw();
    },
    setActiveLine(line) {
      activeLine = line;
      updateActive(true);
    },
    relabel,
    dispose() {
      el.replaceChildren();
    },
  };
}
