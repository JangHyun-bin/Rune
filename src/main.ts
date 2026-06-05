import "./styles.css";
import { editorState, createEditorView, setEditorText } from "./editor/editor";
import { type TabsState, emptyTabs, activeTab, openOrFocus, newUntitled, setActive, updateActiveText, markActiveSaved, closeTab, tabDirty } from "./workspace/tabs";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { mountChrome } from "./chrome/chrome";
import { setDocPath } from "./editor/docContext";
import { mountFileTree } from "./workspace/fileTree";
import { parentDir } from "./workspace/paths";
import { sparkleSvg } from "./brand/sparkle";
import { mountTabBar } from "./workspace/tabBar";
import { autosave } from "./workspace/autosave";
import { listen } from "@tauri-apps/api/event";
import { mountConflictBanner } from "./workspace/conflictBanner";
import { mountErrorBanner } from "./workspace/errorBanner";
import { mountCommandPalette, type PaletteItem } from "./workspace/commandPalette";
import { exportHtml, exportPdf } from "./export/exportDoc";
import { mountSearchPanel } from "./workspace/searchPanel";
import { mountSettingsPanel } from "./workspace/settingsPanel";
import { showLanguagePicker } from "./workspace/languagePicker";
import { mountHelpPanel } from "./workspace/helpPanel";
import { t as tr, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n/i18n";

const chrome = mountChrome(document.getElementById("titlebar")!, document.getElementById("statusbar")!, {
  onOpenSettings: () => settingsPanel.open(),
});
document.getElementById("sidebar-head")!.innerHTML =
  `<span class="brand-mark">${sparkleSvg(20)}</span><span class="brand-word">RUNE</span>`;
const tree = mountFileTree(document.getElementById("filetree")!, (p) => void openPath(p), () => void openFolder());
const tabBar = mountTabBar(document.getElementById("tabbar")!, { onSelect: switchTo, onClose: requestClose });

let tabs: TabsState = emptyTabs();
const states = new Map<string, EditorState>();
let view: EditorView;
const auto = autosave(800, () => void autoSave());
let currentFolder: string | null = null;
let workspaceFiles: { name: string; path: string }[] = [];

function prefersDark(): boolean { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
function settingsSnapshot() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  return { theme, lastFolder: currentFolder, openTabs: tabs.tabs.map((t) => t.path).filter((p): p is string => !!p), locale: getLocale(), editorWidth: currentEditorWidth() };
}
function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  scheduleSaveSettings();
}
function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function currentEditorWidth(): "readable" | "wide" {
  return document.documentElement.getAttribute("data-editor-width") === "wide" ? "wide" : "readable";
}
function applyEditorWidth(w: "readable" | "wide"): void {
  document.documentElement.setAttribute("data-editor-width", w);
  scheduleSaveSettings();
}
function flipEditorWidth(): void {
  applyEditorWidth(currentEditorWidth() === "wide" ? "readable" : "wide");
}
const helpPanel = mountHelpPanel();
const settingsPanel = mountSettingsPanel({
  onLocale: (l) => applyLocale(l),
  onTheme: (th) => applyTheme(th),
  getTheme: currentTheme,
  onEditorWidth: (w) => applyEditorWidth(w),
  getEditorWidth: currentEditorWidth,
  onHelp: () => helpPanel.open(),
  onSetDefault: () => void commands.openDefaultAppsSettings(),
});
function applyLocale(l: Locale): void {
  setLocale(l);
  chrome.relabel();
  syncActiveUI();
  settingsPanel.refresh();
  scheduleSaveSettings();
}
let saveTimer: number | undefined;
function scheduleSaveSettings() {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void commands.saveSettings(settingsSnapshot()), 500);
}

function baseName(p: string): string { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; }
function exportTitle(): string { const t = activeTab(tabs); return t?.path ? baseName(t.path).replace(/\.(md|markdown)$/i, "") : "untitled"; }
function extraExts() { return [EditorView.updateListener.of((u) => { if (u.selectionSet) refreshStatus(); }), auto.ext, Prec.highest(keymap.of([{ key: "Mod-k", run: () => { palette.toggle(); return true; }, preventDefault: true }]))]; }
function onChange(text: string) { tabs = updateActiveText(tabs, text); syncActiveUI(); }

function refreshStatus(): void {
  if (!view) return;
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  chrome.setStatus(text, line.number, head - line.from + 1);
}
function syncActiveUI(): void {
  const t = activeTab(tabs);
  setDocPath(t?.path ?? null);
  chrome.setTitle(t?.path ? baseName(t.path) : tr("doc.untitled"), t ? tabDirty(t) : false);
  tabBar.render(tabs);
  tree.setActive(t?.path ?? null);
  refreshStatus();
}
function showActive(): void {
  const id = tabs.activeId!;
  const t = activeTab(tabs);
  let st = states.get(id);
  if (!st) { st = editorState(t?.currentText ?? "", onChange, extraExts()); states.set(id, st); }
  view.setState(st);
  syncActiveUI();
}
function switchTo(id: string): void {
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = setActive(tabs, id);
  showActive();
  scheduleSaveSettings();
}
async function openPath(path: string): Promise<void> {
  const existing = tabs.tabs.find((t) => t.path === path);
  if (existing) { switchTo(existing.id); return; }
  const res = await commands.readFile(path);
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.readFile", { msg: res.error })); return; }
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = openOrFocus(tabs, path, res.data);
  showActive();
  if (!currentFolder) { const dir = parentDir(path); if (dir) await loadFolder(dir).catch(() => {}); }
  scheduleSaveSettings();
}
function newDoc(): void {
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = newUntitled(tabs);
  showActive();
  scheduleSaveSettings();
}
async function openFile(): Promise<void> {
  const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
  if (typeof selected === "string") await openPath(selected);
}
function flattenFiles(nodes: import("./ipc/bindings").FileNode[]): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const walk = (ns: import("./ipc/bindings").FileNode[]) => { for (const n of ns) { if (n.isDir) walk(n.children); else out.push({ name: n.name, path: n.path }); } };
  walk(nodes);
  return out;
}
async function loadFolder(dir: string): Promise<void> {
  const res = await commands.listDir(dir);
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.openFolder", { msg: res.error })); tree.showError(); throw new Error(res.error); }
  tree.render(res.data);
  workspaceFiles = flattenFiles(res.data);
  currentFolder = dir;
  void commands.watchFolder(dir);
}
async function openFolder(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  try { await loadFolder(dir); } catch { return; }
  scheduleSaveSettings();
}
function requestClose(id: string): void {
  const t = tabs.tabs.find((x) => x.id === id);
  if (t && tabDirty(t) && !confirm(tr("confirm.closeDirty"))) return;
  if (tabs.activeId && view && tabs.activeId !== id) states.set(tabs.activeId, view.state);
  states.delete(id);
  tabs = closeTab(tabs, id);
  if (!tabs.activeId) tabs = newUntitled(tabs);
  showActive();
  scheduleSaveSettings();
}
async function doSave(): Promise<void> {
  const t = activeTab(tabs); if (!t) return;
  let path = t.path;
  if (!path) {
    const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof chosen !== "string") return;
    path = chosen;
  }
  const text = view.state.doc.toString();
  const res = await commands.writeFile(path, text);
  if (res.status === "error") { console.error(res.error); return; }
  tabs = markActiveSaved(tabs, path, text);
  syncActiveUI();
}
async function autoSave(): Promise<void> {
  const t = activeTab(tabs);
  if (!t || !t.path || !tabDirty(t)) return;
  const text = view.state.doc.toString();
  const res = await commands.writeFile(t.path, text);
  if (res.status === "error") { console.error(res.error); return; }
  tabs = markActiveSaved(tabs, t.path, text);
  syncActiveUI();
}

function flipTheme(): void {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  scheduleSaveSettings();
}
function paletteItems(): PaletteItem[] {
  const cmds: PaletteItem[] = [
    { label: tr("cmd.newTab"), run: () => newDoc() },
    { label: tr("cmd.openFile"), run: () => void openFile() },
    { label: tr("cmd.openFolder"), run: () => void openFolder() },
    { label: tr("cmd.save"), run: () => void doSave() },
    { label: tr("cmd.toggleTheme"), run: () => flipTheme() },
    { label: tr("cmd.toggleWidth"), run: () => flipEditorWidth() },
    { label: tr("cmd.closeTab"), run: () => { if (tabs.activeId) requestClose(tabs.activeId); } },
    { label: tr("cmd.exportHtml"), run: () => void exportHtml(view.state.doc.toString(), exportTitle()) },
    { label: tr("cmd.exportPdf"), run: () => void exportPdf(view.state.doc.toString(), exportTitle()) },
    { label: tr("cmd.search"), run: () => searchPanel.toggle() },
    { label: tr("settings.title"), run: () => settingsPanel.open() },
    { label: tr("cmd.help"), run: () => helpPanel.open() },
    ...LOCALES.map(({ code, label }) => ({ label: `${tr("cmd.language")}: ${label}`, run: () => applyLocale(code) })),
  ];
  const files: PaletteItem[] = workspaceFiles.map((f) => ({ label: f.name, hint: f.path, run: () => void openPath(f.path) }));
  return [...cmds, ...files];
}
const palette = mountCommandPalette(paletteItems);
function jumpToLine(n: number): void {
  const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  view.focus();
}
const searchPanel = mountSearchPanel(
  () => currentFolder,
  (path, line) => { void (async () => { await openPath(path); jumpToLine(line); })(); },
);
async function restore(): Promise<void> {
  const res = await commands.loadSettings();
  const s = res.status === "ok" ? res.data : { theme: null, lastFolder: null, openTabs: [], locale: null, editorWidth: null };
  document.documentElement.setAttribute("data-theme", s.theme === "light" || s.theme === "dark" ? s.theme : (prefersDark() ? "dark" : "light"));
  document.documentElement.setAttribute("data-editor-width", s.editorWidth === "wide" ? "wide" : "readable");

  // Resolve the UI language BEFORE loading any content, so the app never flashes
  // a language the user didn't choose. On first run (no saved locale) we ask once
  // with a picker — pre-selecting a best-effort guess — and persist the choice.
  const validCodes = LOCALES.map((x) => x.code) as string[];
  const saved = s.locale && validCodes.includes(s.locale) ? (s.locale as Locale) : null;
  const firstRun = saved === null;
  setLocale(saved ?? detectLocale());
  if (firstRun) {
    setLocale(await showLanguagePicker(getLocale()));
  }
  chrome.relabel();

  if (s.lastFolder) { await loadFolder(s.lastFolder).catch(() => {}); }
  let opened = false;
  for (const p of s.openTabs) { await openPath(p); opened = true; }
  if (!opened) newDoc();
  syncActiveUI();

  // Persist the first-run language pick alongside the (now restored) session state.
  if (firstRun) { void commands.saveSettings(settingsSnapshot()); }

  // If Rune was launched by double-clicking a .md (file association), open it.
  const launch = await commands.takeLaunchFile();
  if (launch.status === "ok" && launch.data) { await openPath(launch.data); }
}

const banner = mountConflictBanner(document.getElementById("main-col")!, {
  onReload: () => void reloadActive(),
  onKeep: () => {},
});
const errorBanner = mountErrorBanner(document.getElementById("main-col")!);

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}
async function reloadActive(): Promise<void> {
  const t = activeTab(tabs);
  if (!t?.path) return;
  const res = await commands.readFile(t.path);
  if (res.status === "error") { console.error(res.error); return; }
  setEditorText(view, res.data);
  tabs = markActiveSaved(tabs, t.path, res.data);
  syncActiveUI();
}
let fsTimer: number | undefined;
function onFsChange(paths: string[]): void {
  if (fsTimer !== undefined) clearTimeout(fsTimer);
  fsTimer = window.setTimeout(async () => {
    if (currentFolder) await loadFolder(currentFolder).catch(() => {});
    const t = activeTab(tabs);
    if (t?.path && paths.some((p) => samePath(p, t.path!))) {
      if (!tabDirty(t)) await reloadActive();
      else banner.show();
    }
  }, 250);
}
void listen<string[]>("fs-change", (e) => onFsChange(e.payload));
// A .md opened via file association while Rune is already running (single-instance / macOS).
void listen<string>("open-file", (e) => { void openPath(e.payload); });

// init: create the editor view with a bare empty state; restore() opens tabs.
view = createEditorView(document.getElementById("editor")!, editorState("", onChange, extraExts()));
void restore();

window.addEventListener("blur", () => auto.flush());
window.addEventListener("keydown", (e) => {
  if (e.key === "F1") { e.preventDefault(); helpPanel.toggle(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); searchPanel.toggle(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); flipEditorWidth(); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newDoc(); return; }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (tabs.activeId) requestClose(tabs.activeId); return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); void exportHtml(view.state.doc.toString(), exportTitle()); return; }
});
