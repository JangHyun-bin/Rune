import { t } from "../i18n/i18n";
import type { HeadingItem } from "../editor/outline";

export interface OutlinePanel {
  render(items: HeadingItem[]): void;
  setActiveLine(line: number): void;
}

export function mountOutlinePanel(el: HTMLElement, onJump: (line: number) => void): OutlinePanel {
  let items: HeadingItem[] = [];
  let activeLine = 1;

  function draw(): void {
    el.replaceChildren();
    el.className = "outline-panel";

    const title = document.createElement("div");
    title.className = "outline-title";
    title.textContent = t("outline.title");
    el.appendChild(title);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = t("outline.empty");
      el.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "outline-list";
    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "outline-row" + (item.line === activeLine ? " active" : "");
      row.style.setProperty("--level", String(item.level));
      row.textContent = item.text;
      row.title = item.text;
      row.addEventListener("click", () => onJump(item.line));
      list.appendChild(row);
    }
    el.appendChild(list);
  }

  return {
    render(next) {
      items = next;
      draw();
    },
    setActiveLine(line) {
      activeLine = line;
      const activeHeading = [...items].reverse().find((item) => item.line <= activeLine)?.line ?? -1;
      const rows = el.querySelectorAll<HTMLButtonElement>(".outline-row");
      rows.forEach((row, idx) => row.classList.toggle("active", items[idx]?.line === activeHeading));
    },
  };
}
