import { t } from "../i18n/i18n";

/**
 * Menu item/submenu id -> i18n key. Ids match what src-tauri/src/menu.rs
 * assigns (the menu-action event payload and set_menu_labels map key);
 * i18n keys are reused from the command palette wherever the same
 * action already has one, so there is one string per concept, not two.
 */
export const MENU_LABEL_KEYS: Record<string, string> = {
  "menu.file": "menu.file",
  "menu.view": "menu.view",
  "menu.help": "menu.help",
  "file.newTab": "cmd.newTab",
  "file.open": "cmd.openFile",
  "file.openFolder": "cmd.openFolder",
  "file.save": "cmd.save",
  "file.saveAs": "cmd.saveAs",
  "file.exportHtml": "cmd.exportHtml",
  "file.exportPdf": "cmd.exportPdf",
  "app.quit": "menu.quit",
  "view.toggleSidebar": "workbench.togglePrimarySidebar",
  "view.togglePanel": "workbench.togglePanel",
  "view.toggleTheme": "cmd.toggleTheme",
  "view.toggleFocusMode": "cmd.toggleFocusMode",
  "help.help": "cmd.help",
};

// Same platform sniff already used elsewhere in the frontend
// (src/main.ts's isMacPlatform, src/workspace/helpPanel.ts's isMac).
const IS_MACOS = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

/**
 * Ids that have a real keyboard shortcut elsewhere (src/main.ts's `keydown`
 * handler), shown as a hint appended to the menu label (spec §3/§5.4). F8
 * has no Ctrl/Cmd prefix — it's the same key on every platform. Every other
 * menu id has no real shortcut and gets no hint.
 */
const SHORTCUT_HINTS: Record<string, string> = {
  "file.newTab": IS_MACOS ? "Cmd+N" : "Ctrl+N",
  "file.open": IS_MACOS ? "Cmd+O" : "Ctrl+O",
  "file.openFolder": IS_MACOS ? "Cmd+Shift+O" : "Ctrl+Shift+O",
  "file.save": IS_MACOS ? "Cmd+S" : "Ctrl+S",
  "file.saveAs": IS_MACOS ? "Cmd+Shift+S" : "Ctrl+Shift+S",
  "file.exportHtml": IS_MACOS ? "Cmd+E" : "Ctrl+E",
  "view.toggleFocusMode": "F8",
};

export function menuLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(MENU_LABEL_KEYS)) {
    const hint = SHORTCUT_HINTS[id];
    out[id] = hint ? `${t(key)}    ${hint}` : t(key);
  }
  // macOS's app-menu Quit keeps Rust's native "Quit Rune" fallback text — don't let the
  // shared menu.quit ("Quit") i18n string overwrite it (finding M6).
  if (IS_MACOS) delete out["app.quit"];
  return out;
}
