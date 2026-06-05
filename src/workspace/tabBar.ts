import type { TabsState, Tab } from "./tabs";
import { tabDirty } from "./tabs";
import { t } from "../i18n/i18n";

export function mountTabBar(
  el: HTMLElement,
  handlers: { onSelect: (id: string) => void; onClose: (id: string) => void; onContextMenu: (id: string, x: number, y: number) => void },
): { render: (s: TabsState) => void } {
  function title(tabItem: Tab): string {
    if (!tabItem.path) return t("doc.untitled");
    const i = Math.max(tabItem.path.lastIndexOf("/"), tabItem.path.lastIndexOf("\\"));
    return i >= 0 ? tabItem.path.slice(i + 1) : tabItem.path;
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
        tab.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handlers.onContextMenu(t.id, e.clientX, e.clientY);
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
