export interface PaletteItem { label: string; hint?: string; run: () => void; }

/** ⌘K 팔레트. provide()는 열릴 때마다 현재 항목(명령+파일)을 반환. */
export function mountCommandPalette(provide: () => PaletteItem[]): { toggle: () => void; isOpen: () => boolean } {
  let open = false;
  let filtered: PaletteItem[] = [];
  let sel = 0;

  const backdrop = document.createElement("div");
  backdrop.className = "cp-backdrop hidden";
  const card = document.createElement("div");
  card.className = "cp-card";
  const input = document.createElement("input");
  input.className = "cp-input";
  input.placeholder = "명령 또는 파일…";
  const list = document.createElement("div");
  list.className = "cp-list";
  card.append(input, list);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function fuzzy(q: string, label: string): boolean {
    const s = label.toLowerCase();
    const t = q.toLowerCase();
    let i = 0;
    for (const ch of s) { if (ch === t[i]) i++; if (i === t.length) return true; }
    return t.length === 0;
  }
  function renderList() {
    list.replaceChildren();
    filtered.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "cp-row" + (idx === sel ? " sel" : "");
      const lab = document.createElement("span"); lab.className = "cp-label"; lab.textContent = it.label;
      row.appendChild(lab);
      if (it.hint) { const h = document.createElement("span"); h.className = "cp-hint"; h.textContent = it.hint; row.appendChild(h); }
      row.addEventListener("mousedown", (e) => { e.preventDefault(); choose(idx); });
      list.appendChild(row);
    });
  }
  function refilter() {
    const q = input.value.trim();
    const all = provideCache;
    filtered = q === "" ? all.slice(0, 50) : all.filter((i) => fuzzy(q, i.label) || (i.hint ? fuzzy(q, i.hint) : false)).slice(0, 50);
    sel = 0;
    renderList();
  }
  let provideCache: PaletteItem[] = [];
  function show() { open = true; provideCache = provide(); input.value = ""; refilter(); backdrop.classList.remove("hidden"); input.focus(); }
  function hide() { open = false; backdrop.classList.add("hidden"); }
  function choose(idx: number) { const it = filtered[idx]; hide(); if (it) it.run(); }

  input.addEventListener("input", refilter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); renderList(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); renderList(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) hide(); });

  return { toggle: () => (open ? hide() : show()), isOpen: () => open };
}
