import type { TabsState, Tab } from "./tabs";
import { tabDirty } from "./tabs";
import { t } from "../i18n/i18n";

const DEFAULT_PANE_ID = "pane-1";

export interface TabDragPayload {
  paneId: string;
  tabId: string;
  path: string | null;
  duplicate: boolean;
}

export interface TabBarHandlers {
  paneId?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onTabDragStart?: (payload: TabDragPayload) => void;
}

export function mountTabBar(
  el: HTMLElement,
  handlers: TabBarHandlers,
): { render: (s: TabsState) => void } {
  const paneId = handlers.paneId ?? DEFAULT_PANE_ID;
  el.dataset.paneId = paneId;

  function title(tabItem: Tab): string {
    if (!tabItem.path) return t("doc.untitled");
    const i = Math.max(tabItem.path.lastIndexOf("/"), tabItem.path.lastIndexOf("\\"));
    return i >= 0 ? tabItem.path.slice(i + 1) : tabItem.path;
  }
  return {
    render(s) {
      el.replaceChildren();
      for (const tabItem of s.tabs) {
        const tab = document.createElement("div");
        tab.className = "tab" + (tabItem.id === s.activeId ? " active" : "");
        tab.draggable = true;
        tab.setAttribute("draggable", "true");
        tab.addEventListener("click", (e) => {
          if (!(e.target as HTMLElement).closest(".close")) handlers.onSelect(tabItem.id);
        });
        tab.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          handlers.onContextMenu(tabItem.id, e.clientX, e.clientY);
        });
        tab.addEventListener("dragstart", (event) => {
          handlers.onTabDragStart?.({
            paneId,
            tabId: tabItem.id,
            path: tabItem.path,
            duplicate: event.ctrlKey || event.metaKey,
          });
        });
        if (tabDirty(tabItem)) {
          const dot = document.createElement("span");
          dot.className = "dirty";
          dot.textContent = "●";
          tab.appendChild(dot);
        }
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = title(tabItem);
        tab.appendChild(label);
        const close = document.createElement("span");
        close.className = "close";
        close.textContent = "×";
        close.addEventListener("click", (e) => { e.stopPropagation(); handlers.onClose(tabItem.id); });
        tab.appendChild(close);
        el.appendChild(tab);
      }
    },
  };
}
