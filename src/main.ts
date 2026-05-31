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
import { mountTabBar } from "./workspace/tabBar";
import { autosave } from "./workspace/autosave";
import { listen } from "@tauri-apps/api/event";
import { mountConflictBanner } from "./workspace/conflictBanner";
import { mountCommandPalette, type PaletteItem } from "./workspace/commandPalette";
import { exportHtml, exportPdf } from "./export/exportDoc";

const chrome = mountChrome(document.getElementById("titlebar")!, document.getElementById("statusbar")!, {
  onThemeChange: () => scheduleSaveSettings(),
});
const tree = mountFileTree(document.getElementById("sidebar")!, (p) => void openPath(p));
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
  return { theme, lastFolder: currentFolder, openTabs: tabs.tabs.map((t) => t.path).filter((p): p is string => !!p) };
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
  chrome.setTitle(t?.path ? baseName(t.path) : "제목 없음", t ? tabDirty(t) : false);
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
  if (res.status === "error") { console.error(res.error); return; }
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = openOrFocus(tabs, path, res.data);
  showActive();
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
  if (res.status === "error") { console.error(res.error); throw new Error(res.error); }
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
  if (t && tabDirty(t) && !confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
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
    { label: "새 탭", run: () => newDoc() },
    { label: "파일 열기…", run: () => void openFile() },
    { label: "폴더 열기…", run: () => void openFolder() },
    { label: "저장", run: () => void doSave() },
    { label: "테마 전환", run: () => flipTheme() },
    { label: "탭 닫기", run: () => { if (tabs.activeId) requestClose(tabs.activeId); } },
    { label: "HTML로 내보내기", run: () => void exportHtml(view.state.doc.toString(), exportTitle()) },
    { label: "PDF로 내보내기", run: () => void exportPdf(view.state.doc.toString(), exportTitle()) },
  ];
  const files: PaletteItem[] = workspaceFiles.map((f) => ({ label: f.name, hint: f.path, run: () => void openPath(f.path) }));
  return [...cmds, ...files];
}
const palette = mountCommandPalette(paletteItems);
async function restore(): Promise<void> {
  const res = await commands.loadSettings();
  const s = res.status === "ok" ? res.data : { theme: null, lastFolder: null, openTabs: [] };
  document.documentElement.setAttribute("data-theme", s.theme === "light" || s.theme === "dark" ? s.theme : (prefersDark() ? "dark" : "light"));
  if (s.lastFolder) { await loadFolder(s.lastFolder).catch(() => {}); }
  let opened = false;
  for (const p of s.openTabs) { await openPath(p); opened = true; }
  if (!opened) newDoc();
  syncActiveUI();
}

const banner = mountConflictBanner(document.getElementById("main-col")!, {
  onReload: () => void reloadActive(),
  onKeep: () => {},
});

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

// init: create the editor view with a bare empty state; restore() opens tabs.
view = createEditorView(document.getElementById("editor")!, editorState("", onChange, extraExts()));
void restore();

window.addEventListener("blur", () => auto.flush());
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newDoc(); return; }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (tabs.activeId) requestClose(tabs.activeId); return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); void exportHtml(view.state.doc.toString(), exportTitle()); return; }
});
