import { t } from "../i18n/i18n";
import { parseHeadings } from "../editor/outline";

export interface PaletteItem { label: string; hint?: string; scope?: "heading"; run: () => void; }

function fuzzy(query: string, label: string): boolean {
  const source = label.toLowerCase();
  const target = query.toLowerCase();
  let index = 0;
  for (const char of source) {
    if (char === target[index]) index++;
    if (index === target.length) return true;
  }
  return target.length === 0;
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const trimmed = query.trim();
  const headingsOnly = trimmed.startsWith("@");
  const target = headingsOnly ? trimmed.slice(1).trim() : trimmed;
  return items
    .filter((item) => (item.scope === "heading") === headingsOnly)
    .filter((item) => target === "" || fuzzy(target, item.label) || (item.hint ? fuzzy(target, item.hint) : false))
    .slice(0, 50);
}

export function headingPaletteItems(markdown: string, onJump: (line: number) => void): PaletteItem[] {
  return parseHeadings(markdown).map((heading) => ({
    label: heading.text,
    hint: `H${heading.level} · L${heading.line}`,
    scope: "heading",
    run: () => onJump(heading.line),
  }));
}

/** ⌘K 팔레트. provide()는 열릴 때마다 현재 항목(명령+파일)을 반환. */
export function mountCommandPalette(provide: () => PaletteItem[]): { toggle: () => void; isOpen: () => boolean } {
  let open = false;
  let filtered: PaletteItem[] = [];
  let sel = 0;
  let returnFocus: HTMLElement | null = null;

  const backdrop = document.createElement("div");
  backdrop.className = "cp-backdrop hidden";
  const card = document.createElement("div");
  card.className = "cp-card";
  const input = document.createElement("input");
  input.className = "cp-input";
  input.placeholder = t("palette.placeholder");
  const list = document.createElement("div");
  list.className = "cp-list";
  card.append(input, list);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

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
    filtered = filterPaletteItems(provideCache, input.value);
    sel = 0;
    renderList();
  }
  let provideCache: PaletteItem[] = [];
  function show() {
    open = true;
    returnFocus = document.activeElement && "focus" in document.activeElement
      ? document.activeElement as HTMLElement
      : null;
    input.placeholder = t("palette.placeholder");
    provideCache = provide();
    input.value = "";
    refilter();
    backdrop.classList.remove("hidden");
    input.focus();
  }
  function hide() {
    open = false;
    backdrop.classList.add("hidden");
    const target = returnFocus;
    returnFocus = null;
    target?.focus();
  }
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
