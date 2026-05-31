import type { FileNode } from "../ipc/bindings";

export interface FileTree {
  render(root: FileNode[]): void;
  setActive(path: string | null): void;
}

/** sidebar에 트리를 그리고 파일 클릭 시 onOpen(path) 호출. */
export function mountFileTree(sidebar: HTMLElement, onOpen: (path: string) => void): FileTree {
  let activePath: string | null = null;
  const expanded = new Set<string>();
  let lastRoot: FileNode[] = [];

  function rowEl(node: FileNode, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "ft-row" + (!node.isDir && node.path === activePath ? " active" : "");
    row.style.paddingLeft = `${8 + depth * 12}px`;
    const tw = document.createElement("span");
    tw.className = "ft-twist";
    tw.textContent = node.isDir ? (expanded.has(node.path) ? "▾" : "▸") : "";
    row.appendChild(tw);
    row.appendChild(document.createTextNode(node.name));
    row.addEventListener("click", () => {
      if (node.isDir) {
        if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path);
        draw();
      } else {
        onOpen(node.path);
      }
    });
    return row;
  }

  function draw() {
    sidebar.replaceChildren();
    const ws = document.createElement("div");
    ws.className = "ft-ws";
    ws.textContent = "워크스페이스";
    sidebar.appendChild(ws);
    const walk = (nodes: FileNode[], depth: number) => {
      for (const n of nodes) {
        sidebar.appendChild(rowEl(n, depth));
        if (n.isDir && expanded.has(n.path)) walk(n.children, depth + 1);
      }
    };
    walk(lastRoot, 0);
  }

  return {
    render(root) { lastRoot = root; draw(); },
    setActive(path) { activePath = path; draw(); },
  };
}
