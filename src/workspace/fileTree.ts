import type { FileNode } from "../ipc/bindings";
import { t } from "../i18n/i18n";

export interface FileTree {
  render(root: FileNode[], folderPath?: string | null): void;
  setActive(path: string | null): void;
  showNoFolder(): void;
  showError(): void;
}

export interface FileTreeActions {
  onNewFile?: () => void;
  onNewFolder?: () => void;
}

type Mode = "tree" | "noFolder" | "error";
type ActionIcon = "folder" | "file-plus" | "folder-plus";

const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_PATHS: Record<ActionIcon, string[]> = {
  folder: ["M3.5 6.5h5.8l1.5 2h9.7v9H3.5z"],
  "file-plus": ["M6.5 3.5h7.5l4 4v13h-11.5z", "M14 3.5v4h4", "M12.25 10.75v5", "M9.75 13.25h5"],
  "folder-plus": ["M3.5 6.5h5.8l1.5 2h9.7v9H3.5z", "M12 10.75v5", "M9.5 13.25h5"],
};

/** sidebar에 트리를 그리고 파일 클릭 시 onOpen(path) 호출.
 *  빈/미선택/오류 상태에서는 안내문 + '폴더 열기' 버튼(onOpenFolder)을 보여준다. */
export function mountFileTree(
  sidebar: HTMLElement,
  onOpen: (path: string) => void,
  onOpenFolder: () => void,
  onContextMenu: (node: FileNode, x: number, y: number) => void,
  actions: FileTreeActions = {},
): FileTree {
  let activePath: string | null = null;
  let currentFolderPath: string | null = null;
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
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onContextMenu(node, e.clientX, e.clientY);
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

  function actionIcon(icon: ActionIcon): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of ICON_PATHS[icon]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function actionButton(label: string, icon: ActionIcon, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ft-action";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(actionIcon(icon));
    btn.addEventListener("click", onClick);
    return btn;
  }

  function headerEl(): HTMLElement {
    const header = document.createElement("div");
    header.className = "ft-header";
    const ws = document.createElement("div");
    ws.className = "ft-ws";
    ws.textContent = t("tree.workspace");
    const actionRow = document.createElement("div");
    actionRow.className = "ft-actions";
    actionRow.appendChild(actionButton(currentFolderPath ? t("tree.changeFolder") : t("tree.openFolder"), "folder", () => onOpenFolder()));
    if (currentFolderPath) {
      actionRow.appendChild(actionButton(t("menu.newFile"), "file-plus", () => actions.onNewFile?.()));
      actionRow.appendChild(actionButton(t("menu.newFolder"), "folder-plus", () => actions.onNewFolder?.()));
    }
    header.append(ws, actionRow);
    return header;
  }

  function draw() {
    sidebar.replaceChildren();
    sidebar.appendChild(headerEl());

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
    render(root, folderPath = null) { mode = "tree"; lastRoot = root; currentFolderPath = folderPath; draw(); },
    setActive(path) { activePath = path; draw(); },
    showNoFolder() { mode = "noFolder"; currentFolderPath = null; draw(); },
    showError() { mode = "error"; currentFolderPath = null; draw(); },
  };
}
