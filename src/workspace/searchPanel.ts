import { commands, type SearchHit } from "../ipc/bindings";
import { t } from "../i18n/i18n";

export interface SearchPanel {
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function mountSearchPanel(
  host: HTMLElement,
  getFolder: () => string | null,
  openHit: (path: string, line: number) => void,
): SearchPanel {
  const card = document.createElement("div"); card.className = "sp-card";
  const input = document.createElement("input"); input.className = "sp-input"; input.placeholder = t("search.placeholder");
  const list = document.createElement("div"); list.className = "sp-list";
  card.append(input, list); host.appendChild(card);

  const baseName = (p: string) => { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; };
  const msg = (text: string) => { const e = document.createElement("div"); e.className = "sp-empty"; e.textContent = text; list.replaceChildren(e); };

  function renderHits(hits: SearchHit[], q: string) {
    if (hits.length === 0) { msg(q ? t("search.empty") : ""); return; }
    list.replaceChildren();
    for (const h of hits) {
      const row = document.createElement("div"); row.className = "sp-row";
      const top = document.createElement("div"); top.className = "sp-file"; top.textContent = `${baseName(h.path)}:${h.line}`;
      const snip = document.createElement("div"); snip.className = "sp-snip"; snip.textContent = h.snippet;
      row.append(top, snip);
      row.addEventListener("mousedown", (e) => { e.preventDefault(); openHit(h.path, h.line); });
      list.appendChild(row);
    }
  }
  let timer: number | undefined;
  function runSearch() {
    const folder = getFolder();
    if (!folder) { msg(t("search.noFolder")); return; }
    const q = input.value.trim();
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const res = await commands.search(folder, q);
      if (res.status === "ok") renderHits(res.data, q);
      else console.error(res.error);
    }, 200);
  }
  input.addEventListener("input", runSearch);
  return {
    focus() { input.focus(); },
    relabel() { input.placeholder = t("search.placeholder"); },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      host.replaceChildren();
    },
  };
}
