import { t } from "../i18n/i18n";

// Modifier glyphs differ per platform; key combos shown match the real bindings
// registered in main.ts (global keydown) and the editor keymap.
const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";
const SHIFT = isMac ? "⇧" : "Shift";

type Row = { keys: string[]; labelKey: string };
type Group = { titleKey: string; rows: Row[] };

const GROUPS: Group[] = [
  { titleKey: "help.files", rows: [
    { keys: [MOD, "N"], labelKey: "cmd.newTab" },
    { keys: [MOD, "O"], labelKey: "cmd.openFile" },
    { keys: [MOD, SHIFT, "O"], labelKey: "cmd.openFolder" },
    { keys: [MOD, "S"], labelKey: "cmd.save" },
    { keys: [MOD, "W"], labelKey: "cmd.closeTab" },
  ] },
  { titleKey: "help.tabs", rows: [
    { keys: [MOD, "Tab"], labelKey: "help.nextTab" },
    { keys: [MOD, SHIFT, "Tab"], labelKey: "help.prevTab" },
    { keys: [MOD, "1-9"], labelKey: "help.gotoTab" },
  ] },
  { titleKey: "help.editing", rows: [
    { keys: [MOD, "Z"], labelKey: "help.undo" },
    { keys: [MOD, SHIFT, "Z"], labelKey: "help.redo" },
    { keys: [MOD, "B"], labelKey: "help.bold" },
    { keys: [MOD, "I"], labelKey: "help.italic" },
    { keys: ["Tab"], labelKey: "help.indent" },
    { keys: [SHIFT, "Tab"], labelKey: "help.outdent" },
    { keys: [MOD, "F"], labelKey: "cmd.findReplace" },
  ] },
  { titleKey: "help.tools", rows: [
    { keys: [MOD, "K"], labelKey: "help.commandPalette" },
    { keys: [MOD, SHIFT, "F"], labelKey: "cmd.search" },
    { keys: [MOD, "E"], labelKey: "cmd.exportHtml" },
    { keys: ["F1"], labelKey: "cmd.help" },
    { keys: [MOD, SHIFT, "L"], labelKey: "help.toggleWidth" },
    { keys: [MOD, SHIFT, "M"], labelKey: "cmd.toggleSourceMode" },
  ] },
];

export interface HelpPanel { open: () => void; close: () => void; toggle: () => void; }

export function mountHelpPanel(): HelpPanel {
  const backdrop = document.createElement("div");
  backdrop.className = "help-backdrop hidden";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  const card = document.createElement("div"); card.className = "help-card";
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function build(): void {
    card.replaceChildren();
    backdrop.setAttribute("aria-label", t("help.title"));
    const title = document.createElement("h2"); title.className = "help-title"; title.textContent = t("help.title");
    card.appendChild(title);

    const groups = document.createElement("div"); groups.className = "help-groups";
    for (const g of GROUPS) {
      const sec = document.createElement("section"); sec.className = "help-group";
      const h = document.createElement("h3"); h.className = "help-group-title"; h.textContent = t(g.titleKey);
      sec.appendChild(h);
      for (const r of g.rows) {
        const row = document.createElement("div"); row.className = "help-row";
        const label = document.createElement("span"); label.className = "help-label"; label.textContent = t(r.labelKey);
        const keys = document.createElement("span"); keys.className = "help-keys";
        for (const k of r.keys) { const kbd = document.createElement("kbd"); kbd.textContent = k; keys.appendChild(kbd); }
        row.append(label, keys); sec.appendChild(row);
      }
      groups.appendChild(sec);
    }
    card.appendChild(groups);

    const foot = document.createElement("p"); foot.className = "help-foot"; foot.textContent = t("help.footer");
    card.appendChild(foot);
  }

  const isOpen = () => !backdrop.classList.contains("hidden");
  const open = () => { build(); backdrop.classList.remove("hidden"); };
  const close = () => backdrop.classList.add("hidden");
  const toggle = () => (isOpen() ? close() : open());

  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); } });

  return { open, close, toggle };
}
