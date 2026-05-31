import type { TabsState, Tab } from "./tabs";
import { tabDirty } from "./tabs";

export function mountTabBar(
  el: HTMLElement,
  handlers: { onSelect: (id: string) => void; onClose: (id: string) => void },
): { render: (s: TabsState) => void } {
  function title(t: Tab): string {
    if (!t.path) return "제목 없음";
    const i = Math.max(t.path.lastIndexOf("/"), t.path.lastIndexOf("\\"));
    return i >= 0 ? t.path.slice(i + 1) : t.path;
  }
  return {
    render(s) {
      el.replaceChildren();
      for (const t of s.tabs) {
        const tab = document.createElement("div");
        tab.className = "tab" + (t.id === s.activeId ? " active" : "");
        tab.addEventListener("click", (e) => {
          if (!(e.target as HTMLElement).closest(".close")) handlers.onSelect(t.id);
        });
        if (tabDirty(t)) {
          const dot = document.createElement("span");
          dot.className = "dirty";
          dot.textContent = "●";
          tab.appendChild(dot);
        }
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = title(t);
        tab.appendChild(label);
        const close = document.createElement("span");
        close.className = "close";
        close.textContent = "×";
        close.addEventListener("click", (e) => { e.stopPropagation(); handlers.onClose(t.id); });
        tab.appendChild(close);
        el.appendChild(tab);
      }
    },
  };
}
