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
  getActivePath: () => string | null,
  openHit: (path: string, line: number) => void,
): SearchPanel {
  host.className = `${host.className} sp-host`.trim();
  const card = document.createElement("div"); card.className = "sp-card";
  const input = document.createElement("input"); input.className = "sp-input"; input.type = "search"; input.placeholder = t("search.placeholder");
  const list = document.createElement("div"); list.className = "sp-list";
  card.append(input, list); host.appendChild(card);

  const baseName = (p: string) => { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; };
  const pathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  type MessageKey = "search.noFolder" | "search.empty";
  let messageKey: MessageKey | null = null;
  const msg = (key: MessageKey | null) => {
    messageKey = key;
    const e = document.createElement("div"); e.className = "sp-empty"; e.textContent = key ? t(key) : ""; list.replaceChildren(e);
  };

  function renderHits(hits: SearchHit[], q: string) {
    if (hits.length === 0) { msg(q ? "search.empty" : null); return; }
    messageKey = null;
    list.replaceChildren();
    const activePath = getActivePath();
    const activeKey = activePath ? pathKey(activePath) : null;
    const grouped = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const group = grouped.get(hit.path) ?? [];
      group.push(hit);
      grouped.set(hit.path, group);
    }
    const groups = [...grouped.entries()].sort(([a], [b]) => {
      const aCurrent = pathKey(a) === activeKey;
      const bCurrent = pathKey(b) === activeKey;
      return aCurrent === bCurrent ? a.localeCompare(b) : (aCurrent ? -1 : 1);
    });
    for (const [path, fileHits] of groups) {
      const group = document.createElement("section");
      group.className = `sp-group${pathKey(path) === activeKey ? " current" : ""}`;
      const header = document.createElement("div"); header.className = "sp-group-header";
      const file = document.createElement("div"); file.className = "sp-file"; file.textContent = baseName(path);
      const count = document.createElement("div"); count.className = "sp-count"; count.textContent = String(fileHits.length);
      header.append(file, count);
      group.appendChild(header);
      for (const hit of fileHits) {
        const row = document.createElement("button"); row.className = "sp-row"; row.type = "button";
        const line = document.createElement("span"); line.className = "sp-line"; line.textContent = String(hit.line);
        const snip = document.createElement("span"); snip.className = "sp-snip"; snip.textContent = hit.snippet;
        row.append(line, snip);
        row.addEventListener("click", () => openHit(hit.path, hit.line));
        group.appendChild(row);
      }
      list.appendChild(group);
    }
  }
  let timer: number | undefined;
  function runSearch() {
    const folder = getFolder();
    if (!folder) { msg("search.noFolder"); return; }
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
    relabel() {
      input.placeholder = t("search.placeholder");
      if (messageKey) msg(messageKey);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      host.replaceChildren();
    },
  };
}
