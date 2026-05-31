import { commands, type SearchHit } from "../ipc/bindings";

export function mountSearchPanel(
  getFolder: () => string | null,
  openHit: (path: string, line: number) => void,
): { toggle: () => void } {
  let open = false;
  const backdrop = document.createElement("div"); backdrop.className = "sp-backdrop hidden";
  const card = document.createElement("div"); card.className = "sp-card";
  const input = document.createElement("input"); input.className = "sp-input"; input.placeholder = "워크스페이스 검색…";
  const list = document.createElement("div"); list.className = "sp-list";
  card.append(input, list); backdrop.appendChild(card); document.body.appendChild(backdrop);

  const baseName = (p: string) => { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; };
  const msg = (text: string) => { const e = document.createElement("div"); e.className = "sp-empty"; e.textContent = text; list.replaceChildren(e); };

  function renderHits(hits: SearchHit[], q: string) {
    if (hits.length === 0) { msg(q ? "결과 없음" : ""); return; }
    list.replaceChildren();
    for (const h of hits) {
      const row = document.createElement("div"); row.className = "sp-row";
      const top = document.createElement("div"); top.className = "sp-file"; top.textContent = `${baseName(h.path)}:${h.line}`;
      const snip = document.createElement("div"); snip.className = "sp-snip"; snip.textContent = h.snippet;
      row.append(top, snip);
      row.addEventListener("mousedown", (e) => { e.preventDefault(); hide(); openHit(h.path, h.line); });
      list.appendChild(row);
    }
  }
  let timer: number | undefined;
  function runSearch() {
    const folder = getFolder();
    if (!folder) { msg("폴더를 먼저 여세요 (Ctrl/Cmd-Shift-O)"); return; }
    const q = input.value.trim();
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const res = await commands.search(folder, q);
      if (res.status === "ok") renderHits(res.data, q);
      else console.error(res.error);
    }, 200);
  }
  input.addEventListener("input", runSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); hide(); } });
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) hide(); });
  function show() { open = true; backdrop.classList.remove("hidden"); input.value = ""; list.replaceChildren(); input.focus(); runSearch(); }
  function hide() { open = false; backdrop.classList.add("hidden"); }
  return { toggle: () => (open ? hide() : show()) };
}
