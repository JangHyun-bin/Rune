import type { FileNode } from "../ipc/bindings";
import { t } from "../i18n/i18n";

export interface FileTree {
  render(root: FileNode[]): void;
  setActive(path: string | null): void;
  showNoFolder(): void;
  showError(): void;
}

type Mode = "tree" | "noFolder" | "error";

/** sidebar에 트리를 그리고 파일 클릭 시 onOpen(path) 호출.
 *  빈/미선택/오류 상태에서는 안내문 + '폴더 열기' 버튼(onOpenFolder)을 보여준다. */
export function mountFileTree(
  sidebar: HTMLElement,
  onOpen: (path: string) => void,
  onOpenFolder: () => void,
): FileTree {
  let activePath: string | null = null;
  const expanded = new Set<string>();
  let lastRoot: FileNode[] = [];
  let mode: Mode = "noFolder";

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

  function emptyState(titleKey: string, hintKey: string | null): HTMLElement {
    const box = document.createElement("div");
    box.className = "ft-empty";
    const msg = document.createElement("p");
    msg.className = "ft-empty-msg";
    msg.textContent = t(titleKey);
    box.appendChild(msg);
    if (hintKey) {
      const hint = document.createElement("p");
      hint.className = "ft-empty-hint";
      hint.textContent = t(hintKey);
      box.appendChild(hint);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = t("tree.openFolder");
    btn.addEventListener("click", () => onOpenFolder());
    box.appendChild(btn);
    return box;
  }

  function draw() {
    sidebar.replaceChildren();
    const ws = document.createElement("div");
    ws.className = "ft-ws";
    ws.textContent = t("tree.workspace");
    sidebar.appendChild(ws);

    if (mode === "noFolder") { sidebar.appendChild(emptyState("tree.noFolder", null)); return; }
    if (mode === "error") { sidebar.appendChild(emptyState("tree.error", null)); return; }
    if (lastRoot.length === 0) { sidebar.appendChild(emptyState("tree.empty", "tree.emptyHint")); return; }

    const walk = (nodes: FileNode[], depth: number) => {
      for (const n of nodes) {
        sidebar.appendChild(rowEl(n, depth));
        if (n.isDir && expanded.has(n.path)) walk(n.children, depth + 1);
      }
    };
    walk(lastRoot, 0);
  }

  return {
    render(root) { mode = "tree"; lastRoot = root; draw(); },
    setActive(path) { activePath = path; draw(); },
    showNoFolder() { mode = "noFolder"; draw(); },
    showError() { mode = "error"; draw(); },
  };
}
