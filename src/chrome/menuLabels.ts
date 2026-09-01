import { t } from "../i18n/i18n";

/**
 * Menu item/submenu id -> i18n key. Ids match what src-tauri/src/menu.rs
 * assigns (the menu-action event payload and set_menu_labels map key);
 * i18n keys are reused from the command palette wherever the same
 * action already has one, so there is one string per concept, not two.
 */
const MENU_LABEL_KEYS: Record<string, string> = {
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

export function menuLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(MENU_LABEL_KEYS)) out[id] = t(key);
  return out;
}
