import type { Backlink } from "../ipc/bindings";
import { t } from "../i18n/i18n";

export type BacklinksPanelState = "noDocument" | "loading" | "error" | Backlink[];

export interface BacklinksPanel {
  render(state: BacklinksPanelState): void;
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function sortBacklinks(items: Backlink[]): Backlink[] {
  return [...items].sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line || left.href.localeCompare(right.href));
}

export function mountBacklinksPanel(
  host: HTMLElement,
  onOpen: (path: string, line: number) => void,
): BacklinksPanel {
  let state: BacklinksPanelState = "noDocument";
  host.className = "backlinks-panel";
  host.tabIndex = 0;
  host.setAttribute("aria-label", t("view.backlinks"));

  function draw(): void {
    host.replaceChildren();
    if (typeof state === "string" || state.length === 0) {
      const empty = document.createElement("div");
      empty.className = "backlinks-empty";
      empty.textContent = t(typeof state === "string" ? `backlinks.${state}` : "backlinks.empty");
      host.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "backlinks-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", t("view.backlinks"));
    for (const item of sortBacklinks(state)) {
      const listItem = document.createElement("div");
      listItem.setAttribute("role", "listitem");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "backlink-row";
      row.textContent = `${item.name} · ${t("backlinks.line", { line: item.line })}`;
      row.title = `${item.path}\n${item.href}`;
      row.addEventListener("click", () => onOpen(item.path, item.line));
      listItem.appendChild(row);
      list.appendChild(listItem);
    }
    host.appendChild(list);
  }

  draw();
  return {
    render(next) {
      state = Array.isArray(next) ? [...next] : next;
      draw();
    },
    focus() {
      const row = host.querySelector<HTMLButtonElement>(".backlink-row");
      if (row) row.focus();
      else host.focus();
    },
    relabel() {
      host.setAttribute("aria-label", t("view.backlinks"));
      draw();
    },
    dispose() {
      host.replaceChildren();
    },
  };
}
