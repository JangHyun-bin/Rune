import { commands, type SearchHit } from "../ipc/bindings";
import { t } from "../i18n/i18n";
import { parentDir } from "./paths";

let nextSearchRequestId = 0;
type PanelSearchHit = SearchHit & { currentDocument?: boolean };

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
  getActiveText: () => string | null = () => null,
  jumpCurrent: (line: number) => void = (line) => {
    const path = getActivePath();
    if (path) openHit(path, line);
  },
): SearchPanel {
  host.className = `${host.className} sp-host`.trim();
  const card = document.createElement("div"); card.className = "sp-card";
  const scope = document.createElement("select"); scope.className = "sp-scope";
  scope.setAttribute("aria-label", t("search.scope.label"));
  const scopeOptions = [
    ["document", "search.scope.document"],
    ["folder", "search.scope.folder"],
    ["workspace", "search.scope.workspace"],
  ] as const;
  for (const [value, key] of scopeOptions) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(key);
    scope.appendChild(option);
  }
  scope.value = "workspace";
  const input = document.createElement("input"); input.className = "sp-input"; input.type = "search"; input.placeholder = t("search.placeholder");
  input.setAttribute("aria-label", t("search.query"));
  const summary = document.createElement("div"); summary.className = "sp-summary"; summary.setAttribute("role", "status"); summary.setAttribute("aria-live", "polite");
  const cancel = document.createElement("button"); cancel.className = "sp-cancel"; cancel.type = "button"; cancel.textContent = t("search.cancel"); cancel.hidden = true;
  const status = document.createElement("div"); status.className = "sp-status"; status.append(summary, cancel);
  const list = document.createElement("div"); list.className = "sp-list";
  card.append(scope, input, status, list); host.appendChild(card);

  const baseName = (p: string) => { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; };
  const pathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const displayPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const root = getFolder()?.replace(/\\/g, "/").replace(/\/$/, "");
    return root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? normalized.slice(root.length + 1)
      : baseName(path);
  };
  type MessageKey = "search.noFolder" | "search.noDocument" | "search.empty";
  type SummaryKey = "search.result" | "search.results" | "search.resultsLimited" | "search.searching" | "search.canceled" | "search.failed";
  let messageKey: MessageKey | null = null;
  let summaryKey: SummaryKey | null = null;
  let summaryParams: Record<string, string | number> | undefined;
  let resultRows: HTMLButtonElement[] = [];
  const setSummary = (key: SummaryKey | null, params?: Record<string, string | number>) => {
    summaryKey = key;
    summaryParams = params;
    summary.textContent = key ? t(key, params) : "";
  };
  const msg = (key: MessageKey | null) => {
    messageKey = key;
    cancel.hidden = true;
    setSummary(null);
    resultRows = [];
    const e = document.createElement("div"); e.className = "sp-empty"; e.textContent = key ? t(key) : ""; list.replaceChildren(e);
  };
  const appendHighlighted = (element: HTMLElement, text: string, query: string) => {
    const source = text.toLowerCase();
    const target = query.toLowerCase();
    let start = 0;
    while (target && source.indexOf(target, start) >= 0) {
      const index = source.indexOf(target, start);
      if (index > start) {
        const plain = document.createElement("span"); plain.textContent = text.slice(start, index); element.appendChild(plain);
      }
      const match = document.createElement("mark"); match.className = "sp-match"; match.textContent = text.slice(index, index + target.length); element.appendChild(match);
      start = index + target.length;
    }
    if (start < text.length) {
      const plain = document.createElement("span"); plain.textContent = text.slice(start); element.appendChild(plain);
    }
  };
  const visibleResultRows = () => resultRows.filter((row) => !row.parentElement?.hidden);
  const focusResult = (index: number) => {
    const rows = visibleResultRows();
    rows[Math.max(0, Math.min(index, rows.length - 1))]?.focus();
  };

  function renderHits(hits: PanelSearchHit[], q: string, truncated = false) {
    if (hits.length === 0) { msg(q ? "search.empty" : null); return; }
    messageKey = null;
    cancel.hidden = true;
    setSummary(truncated ? "search.resultsLimited" : (hits.length === 1 ? "search.result" : "search.results"), { count: hits.length });
    list.replaceChildren();
    resultRows = [];
    const activePath = getActivePath();
    const activeKey = activePath ? pathKey(activePath) : null;
    const grouped = new Map<string, PanelSearchHit[]>();
    for (const hit of hits) {
      const group = grouped.get(hit.path) ?? [];
      group.push(hit);
      grouped.set(hit.path, group);
    }
    const groups = [...grouped.entries()].sort(([a], [b]) => {
      const aCurrent = grouped.get(a)?.some((hit) => hit.currentDocument) || pathKey(a) === activeKey;
      const bCurrent = grouped.get(b)?.some((hit) => hit.currentDocument) || pathKey(b) === activeKey;
      return aCurrent === bCurrent ? a.localeCompare(b) : (aCurrent ? -1 : 1);
    });
    for (const [path, fileHits] of groups) {
      const group = document.createElement("section");
      const isCurrent = fileHits.some((hit) => hit.currentDocument) || pathKey(path) === activeKey;
      group.className = `sp-group${isCurrent ? " current" : ""}`;
      const header = document.createElement("button"); header.className = "sp-group-header sp-group-toggle"; header.type = "button";
      header.setAttribute("aria-expanded", "true");
      const file = document.createElement("div"); file.className = "sp-file"; file.textContent = displayPath(path);
      const count = document.createElement("div"); count.className = "sp-count"; count.textContent = String(fileHits.length);
      header.append(file, count);
      const results = document.createElement("div"); results.className = "sp-group-results";
      header.addEventListener("click", () => {
        results.hidden = !results.hidden;
        header.setAttribute("aria-expanded", String(!results.hidden));
      });
      group.append(header, results);
      for (const hit of fileHits) {
        const row = document.createElement("button"); row.className = "sp-row"; row.type = "button";
        const line = document.createElement("span"); line.className = "sp-line"; line.textContent = String(hit.line);
        const snip = document.createElement("span"); snip.className = "sp-snip"; appendHighlighted(snip, hit.snippet, q);
        row.append(line, snip);
        row.addEventListener("click", () => hit.currentDocument ? jumpCurrent(hit.line) : openHit(hit.path, hit.line));
        row.addEventListener("keydown", (event) => {
          const key = (event as KeyboardEvent).key;
          const index = visibleResultRows().indexOf(row);
          if (key === "ArrowDown") { event.preventDefault(); focusResult(index + 1); }
          else if (key === "ArrowUp") { event.preventDefault(); focusResult(index - 1); }
          else if (key === "Home") { event.preventDefault(); focusResult(0); }
          else if (key === "End") { event.preventDefault(); focusResult(visibleResultRows().length - 1); }
          else if (key === "Escape") { event.preventDefault(); input.focus(); }
        });
        resultRows.push(row);
        results.appendChild(row);
      }
      list.appendChild(group);
    }
  }
  let timer: number | undefined;
  let searchRun = 0;
  let activeBackendRequest: number | null = null;
  const cancelBackendSearch = () => {
    if (activeBackendRequest === null) return;
    void commands.cancelSearch(activeBackendRequest);
    activeBackendRequest = null;
  };
  function runSearch() {
    cancelBackendSearch();
    const run = ++searchRun;
    const q = input.value.trim();
    if (timer !== undefined) clearTimeout(timer);
    if (!q) { msg(null); return; }
    if (scope.value !== "document" && !getFolder()) { msg("search.noFolder"); return; }
    timer = window.setTimeout(async () => {
      setSummary("search.searching");
      cancel.hidden = false;
      if (scope.value === "document") {
        const text = getActiveText();
        if (text === null) { msg("search.noDocument"); return; }
        const path = getActivePath() ?? t("search.untitled");
        const hits: PanelSearchHit[] = [];
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (line.toLowerCase().includes(q.toLowerCase())) hits.push({ path, line: index + 1, snippet: line.trim().slice(0, 160), currentDocument: true });
          if (hits.length > 200) break;
        }
        if (run === searchRun) renderHits(hits.slice(0, 200), q, hits.length > 200);
        return;
      }
      const workspaceRoot = getFolder()!;
      const activePath = getActivePath();
      const scopeRoot = scope.value === "folder"
        ? parentDir(activePath ?? "") ?? workspaceRoot
        : null;
      const requestId = ++nextSearchRequestId;
      activeBackendRequest = requestId;
      let res = await commands.searchWorkspaceIndex(workspaceRoot, scopeRoot, q, activePath, requestId);
      if (res.status === "error") {
        res = await commands.search(scopeRoot ?? workspaceRoot, q, requestId);
      }
      if (activeBackendRequest === requestId) activeBackendRequest = null;
      if (run !== searchRun) return;
      if (res.status === "ok") {
        const result = Array.isArray(res.data) ? { hits: res.data, truncated: false } : res.data;
        renderHits(result.hits, q, result.truncated);
      }
      else {
        cancel.hidden = true;
        setSummary("search.failed");
        resultRows = [];
        list.replaceChildren();
        console.error(res.error);
      }
    }, 200);
  }
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "ArrowDown" && visibleResultRows().length) {
      event.preventDefault();
      focusResult(0);
    }
  });
  input.addEventListener("input", runSearch);
  scope.addEventListener("change", runSearch);
  cancel.addEventListener("click", () => {
    searchRun++;
    cancelBackendSearch();
    if (timer !== undefined) clearTimeout(timer);
    cancel.hidden = true;
    setSummary("search.canceled");
    resultRows = [];
    list.replaceChildren();
  });
  return {
    focus() { input.focus(); },
    relabel() {
      input.placeholder = t("search.placeholder");
      input.setAttribute("aria-label", t("search.query"));
      scope.setAttribute("aria-label", t("search.scope.label"));
      scopeOptions.forEach(([, key], index) => { scope.children[index].textContent = t(key); });
      cancel.textContent = t("search.cancel");
      if (messageKey) msg(messageKey);
      else if (summaryKey) setSummary(summaryKey, summaryParams);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      cancelBackendSearch();
      host.replaceChildren();
    },
  };
}
