export interface MenuItem { label: string; run: () => void; danger?: boolean; }

let openMenu: HTMLElement | null = null;
let onDown: ((e: MouseEvent) => void) | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

function closeMenu(): void {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  if (onDown) { document.removeEventListener("mousedown", onDown); onDown = null; }
  if (onKey) { document.removeEventListener("keydown", onKey); onKey = null; }
}

/** Show a right-click menu at (x, y). Dismisses on outside click, Escape, or item run. */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "ctx-item" + (item.danger ? " danger" : "");
    row.textContent = item.label;
    row.addEventListener("click", () => { closeMenu(); item.run(); });
    menu.appendChild(row);
  }
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  document.body.appendChild(menu);
  openMenu = menu;

  // Clamp into the viewport if it overflows.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - r.width - 4) + "px";
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - r.height - 4) + "px";

  // Defer so the click that opened the menu doesn't immediately close it.
  // Listeners persist (not {once}) until closeMenu removes them — clicking the
  // menu's own padding must not disarm outside-dismissal.
  setTimeout(() => {
    if (openMenu !== menu) return; // already closed/replaced
    onDown = (e: MouseEvent) => { if (openMenu && !openMenu.contains(e.target as Node)) closeMenu(); };
    onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
  }, 0);
}
