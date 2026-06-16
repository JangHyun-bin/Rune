import "./styles.css";
import { editorState, createEditorView, setEditorText, type EditorMode } from "./editor/editor";
import { type TabsState, emptyTabs, activeTab, openOrFocus, newUntitled, setActive, updateActiveText, markActiveSaved, closeTab, tabDirty } from "./workspace/tabs";
import { nextTabId, prevTabId, nthTabId } from "./workspace/tabs";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { mountUpdateBanner } from "./workspace/updatePanel";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { mountChrome } from "./chrome/chrome";
import { setDocPath } from "./editor/docContext";
import { mountFileTree } from "./workspace/fileTree";
import { parentDir } from "./workspace/paths";
import { mountTabBar } from "./workspace/tabBar";
import { autosave } from "./workspace/autosave";
import { listen } from "@tauri-apps/api/event";
import { mountConflictBanner } from "./workspace/conflictBanner";
import { mountErrorBanner } from "./workspace/errorBanner";
import { mountCommandPalette, type PaletteItem } from "./workspace/commandPalette";
import { exportHtml, exportPdf } from "./export/exportDoc";
import { mountSearchPanel } from "./workspace/searchPanel";
import { mountFindReplacePanel, type FindReplacePanel } from "./workspace/findReplacePanel";
import { mountSettingsPanel } from "./workspace/settingsPanel";
import { mountLayoutModeControl, normalizeEditorMode, type LayoutModeControl } from "./workspace/layoutModeControl";
import { parseHeadings } from "./editor/outline";
import { mountOutlinePanel } from "./workspace/outlinePanel";
import { showLanguagePicker } from "./workspace/languagePicker";
import { mountHelpPanel } from "./workspace/helpPanel";
import { t as tr, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n/i18n";
import { showContextMenu, type MenuItem } from "./workspace/contextMenu";
import { promptModal } from "./workspace/promptModal";
import { clearFindHighlights, findHighlightExtension, setFindHighlights } from "./editor/findHighlights";
import { mountSplitPreview, type SplitPreview } from "./editor/splitPreview";

const chrome = mountChrome(document.getElementById("titlebar")!, document.getElementById("statusbar")!, {
  onOpenSettings: () => settingsPanel.open(),
});
const editorRoot = document.getElementById("editor")!;
const editorToolbar = document.getElementById("editor-toolbar")!;
const tree = mountFileTree(document.getElementById("filetree")!, (p) => void openPath(p), () => void openFolder(), fileTreeMenu, {
  onNewFile: () => { if (currentFolder) void newFileIn(currentFolder); },
  onNewFolder: () => { if (currentFolder) void newFolderIn(currentFolder); },
});
const tabBar = mountTabBar(document.getElementById("tabbar")!, { onSelect: switchTo, onClose: requestClose, onContextMenu: tabMenu });

let tabs: TabsState = emptyTabs();
const states = new Map<string, EditorState>();
let view: EditorView;
const auto = autosave(800, () => void autoSave());
let currentFolder: string | null = null;
let workspaceFiles: { name: string; path: string }[] = [];
let editorMode: EditorMode = "preview";
let findReplacePanel: FindReplacePanel | null = null;
let splitPreview: SplitPreview | null = null;
let layoutModeControl: LayoutModeControl | null = null;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;

function prefersDark(): boolean { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
function settingsSnapshot() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  return { theme, lastFolder: currentFolder, openTabs: tabs.tabs.map((t) => t.path).filter((p): p is string => !!p), locale: getLocale(), editorWidth: currentEditorWidth(), editorMode, sidebarWidth: currentSidebarWidth() };
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
function currentEditorMode(): EditorMode {
  return editorMode;
}
function syncEditorLayout(): HTMLElement {
  splitPreview?.destroy();
  splitPreview = null;
  editorRoot.className = "";
  editorRoot.replaceChildren();

  const sourcePane = document.createElement("div");
  sourcePane.className = editorMode === "split" ? "editor-pane split-source" : "editor-pane";
  editorRoot.appendChild(sourcePane);

  if (editorMode === "split") {
    editorRoot.className = "editor-split";
    splitPreview = mountSplitPreview(editorRoot);
  }

  if (view) sourcePane.appendChild(view.dom);
  return sourcePane;
}
function syncSplitPreview(): void {
  if (splitPreview && view) splitPreview.update(view.state.doc.toString());
}
function bindSplitPreviewScroll(): void {
  if (splitPreview && view) splitPreview.bindSourceScroller(view.scrollDOM);
}
function applyEditorMode(mode: EditorMode, persist = true): void {
  if (editorMode === mode) return;
  const text = view ? view.state.doc.toString() : (activeTab(tabs)?.currentText ?? "");
  const selection = view?.state.selection;
  const activeId = tabs.activeId;

  editorMode = mode;
  document.documentElement.setAttribute("data-editor-mode", mode);
  states.clear();
  syncEditorLayout();

  if (view) {
    view.setState(editorState(text, onChange, extraExts(), editorMode));
    bindSplitPreviewScroll();
    if (selection && selection.main.to <= view.state.doc.length) {
      view.dispatch({ selection, scrollIntoView: true });
    }
    if (activeId) states.set(activeId, view.state);
  }
  syncSplitPreview();
  syncActiveUI();
  layoutModeControl?.setMode(editorMode);
  settingsPanel.refresh();
  if (persist) scheduleSaveSettings();
}
function flipEditorMode(): void {
  applyEditorMode(currentEditorMode() === "preview" ? "source" : "preview");
}
function maxSidebarWidth(): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 360));
}
function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.min(maxSidebarWidth(), Math.max(SIDEBAR_MIN, Math.round(width)));
}
function currentSidebarWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width");
  const parsed = Number.parseInt(raw, 10);
  return clampSidebarWidth(parsed);
}
function applySidebarWidth(width: number, persist = true): void {
  document.documentElement.style.setProperty("--sidebar-width", `${clampSidebarWidth(width)}px`);
  if (persist) scheduleSaveSettings();
}
function mountSidebarResizer(handle: HTMLElement): void {
  let dragging = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startWidth = SIDEBAR_DEFAULT;
  let moved = false;

  const finish = () => {
    if (!dragging) return;
    if (activePointerId !== null && handle.hasPointerCapture(activePointerId)) {
      handle.releasePointerCapture(activePointerId);
    }
    dragging = false;
    activePointerId = null;
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing-sidebar");
    if (moved) applySidebarWidth(currentSidebarWidth());
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    moved = true;
    applySidebarWidth(startWidth + e.clientX - startX, false);
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startWidth = currentSidebarWidth();
    moved = false;
    handle.classList.add("dragging");
    document.body.classList.add("resizing-sidebar");
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      activePointerId = null;
    }
    e.preventDefault();
  });
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("blur", finish);
}
const helpPanel = mountHelpPanel();
const settingsPanel = mountSettingsPanel({
  onLocale: (l) => applyLocale(l),
  onTheme: (th) => applyTheme(th),
  getTheme: currentTheme,
  onEditorWidth: (w) => applyEditorWidth(w),
  getEditorWidth: currentEditorWidth,
  onEditorMode: (mode) => applyEditorMode(mode),
  getEditorMode: currentEditorMode,
  onHelp: () => helpPanel.open(),
  onSetDefault: () => void commands.openDefaultAppsSettings(),
  onCheckUpdates: () => void checkForUpdates(true),
});
layoutModeControl = mountLayoutModeControl(editorToolbar, currentEditorMode, (mode) => applyEditorMode(mode));
mountSidebarResizer(document.getElementById("sidebar-resizer")!);
function applyLocale(l: Locale): void {
  setLocale(l);
  chrome.relabel();
  layoutModeControl?.relabel();
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
function revealActive(): void {
  const t = activeTab(tabs);
  if (t?.path) void revealItemInDir(t.path);
}
function extraExts() {
  return [
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.docChanged) {
        refreshStatus();
        refreshOutline();
        findReplacePanel?.refresh();
      }
    }),
    findHighlightExtension(),
    auto.ext,
    Prec.highest(keymap.of([{ key: "Mod-k", run: () => { palette.toggle(); return true; }, preventDefault: true }])),
  ];
}
function onChange(text: string) {
  tabs = updateActiveText(tabs, text);
  splitPreview?.update(text);
  syncActiveUI();
}

function refreshStatus(): void {
  if (!view) return;
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  chrome.setStatus(text, line.number, head - line.from + 1);
}
function refreshOutline(): void {
  if (!view) return;
  outlinePanel.render(parseHeadings(view.state.doc.toString()));
  outlinePanel.setActiveLine(view.state.doc.lineAt(view.state.selection.main.head).number);
}
function syncActiveUI(): void {
  const t = activeTab(tabs);
  setDocPath(t?.path ?? null);
  chrome.setTitle(t?.path ? baseName(t.path) : tr("doc.untitled"), t ? tabDirty(t) : false);
  tabBar.render(tabs);
  tree.setActive(t?.path ?? null);
  refreshStatus();
  refreshOutline();
}
function showActive(): void {
  const id = tabs.activeId!;
  const t = activeTab(tabs);
  let st = states.get(id);
  if (!st) { st = editorState(t?.currentText ?? "", onChange, extraExts(), editorMode); states.set(id, st); }
  view.setState(st);
  bindSplitPreviewScroll();
  syncSplitPreview();
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
  // Opened a loose file with no workspace open → load its folder into the tree.
  // `await` is deliberate: currentFolder must be set before scheduleSaveSettings() captures lastFolder.
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
  tree.render(res.data, dir);
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
async function refreshTree(): Promise<void> {
  if (currentFolder) await loadFolder(currentFolder).catch(() => {});
}
async function copyPath(p: string): Promise<void> {
  try { await navigator.clipboard.writeText(p); } catch (e) { console.error(e); }
}
async function renameEntry(path: string, name: string): Promise<void> {
  const next = await promptModal({ title: tr("prompt.rename"), value: name });
  if (!next || next === name) return;
  const res = await commands.renamePath(path, next);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
}
async function deleteEntry(path: string, name: string): Promise<void> {
  if (!confirm(tr("confirm.delete", { name }))) return;
  const res = await commands.deletePath(path);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
}
async function newFileIn(dir: string): Promise<void> {
  const name = await promptModal({ title: tr("prompt.newFile"), value: "untitled.md" });
  if (!name) return;
  const res = await commands.createFile(dir, name);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
  await openPath(res.data);
}
async function newFolderIn(dir: string): Promise<void> {
  const name = await promptModal({ title: tr("prompt.newFolder"), value: "new-folder" });
  if (!name) return;
  const res = await commands.createDir(dir, name);
  if (res.status === "error") { errorBanner.show(tr("error.fileOp", { msg: res.error })); return; }
  await refreshTree();
}
function fileTreeMenu(node: import("./ipc/bindings").FileNode, x: number, y: number): void {
  const items: MenuItem[] = node.isDir
    ? [
        { label: tr("menu.newFile"), run: () => void newFileIn(node.path) },
        { label: tr("menu.newFolder"), run: () => void newFolderIn(node.path) },
        { label: tr("cmd.reveal"), run: () => void revealItemInDir(node.path) },
        { label: tr("menu.copyPath"), run: () => void copyPath(node.path) },
        { label: tr("menu.rename"), run: () => void renameEntry(node.path, node.name) },
        { label: tr("menu.delete"), run: () => void deleteEntry(node.path, node.name), danger: true },
      ]
    : [
        { label: tr("menu.open"), run: () => void openPath(node.path) },
        { label: tr("cmd.reveal"), run: () => void revealItemInDir(node.path) },
        { label: tr("menu.copyPath"), run: () => void copyPath(node.path) },
        { label: tr("menu.rename"), run: () => void renameEntry(node.path, node.name) },
        { label: tr("menu.delete"), run: () => void deleteEntry(node.path, node.name), danger: true },
      ];
  showContextMenu(x, y, items);
}
function closeOthers(keepId: string): void {
  for (const t of [...tabs.tabs]) if (t.id !== keepId) requestClose(t.id);
}
function tabMenu(id: string, x: number, y: number): void {
  const t = tabs.tabs.find((x) => x.id === id);
  const items: MenuItem[] = [
    { label: tr("cmd.closeTab"), run: () => requestClose(id) },
    { label: tr("menu.closeOthers"), run: () => closeOthers(id) },
  ];
  if (t?.path) {
    items.push({ label: tr("menu.copyPath"), run: () => void copyPath(t.path!) });
    items.push({ label: tr("cmd.reveal"), run: () => void revealItemInDir(t.path!) });
  }
  showContextMenu(x, y, items);
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
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.save", { msg: res.error })); return; }
  tabs = markActiveSaved(tabs, path, text);
  syncActiveUI();
}
async function autoSave(): Promise<void> {
  const t = activeTab(tabs);
  if (!t || !t.path || !tabDirty(t)) return;
  const text = view.state.doc.toString();
  const res = await commands.writeFile(t.path, text);
  if (res.status === "error") { console.error(res.error); errorBanner.show(tr("error.save", { msg: res.error })); return; }
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
    { label: tr("menu.newFile"), run: () => { if (currentFolder) void newFileIn(currentFolder); } },
    { label: tr("menu.newFolder"), run: () => { if (currentFolder) void newFolderIn(currentFolder); } },
    { label: tr("cmd.save"), run: () => void doSave() },
    { label: tr("cmd.toggleTheme"), run: () => flipTheme() },
    { label: tr("cmd.toggleWidth"), run: () => flipEditorWidth() },
    { label: tr("cmd.toggleSourceMode"), run: () => flipEditorMode() },
    { label: tr("cmd.closeTab"), run: () => { if (tabs.activeId) requestClose(tabs.activeId); } },
    { label: tr("cmd.exportHtml"), run: () => void exportHtml(view.state.doc.toString(), exportTitle()) },
    { label: tr("cmd.exportPdf"), run: () => void exportPdf(view.state.doc.toString(), exportTitle()) },
    { label: tr("cmd.findReplace"), run: () => findReplacePanel?.open() },
    { label: tr("cmd.search"), run: () => searchPanel.toggle() },
    { label: tr("cmd.reveal"), run: () => revealActive() },
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
const outlinePanel = mountOutlinePanel(document.getElementById("outline")!, jumpToLine);
const searchPanel = mountSearchPanel(
  () => currentFolder,
  (path, line) => { void (async () => { await openPath(path); jumpToLine(line); })(); },
);
findReplacePanel = mountFindReplacePanel({
  getText: () => view.state.doc.toString(),
  getCursor: () => view.state.selection.main.head,
  getSelectionText: () => {
    const range = view.state.selection.main;
    return range.empty ? "" : view.state.sliceDoc(range.from, range.to);
  },
  getSelectionRange: () => {
    const range = view.state.selection.main;
    return range.empty ? null : { from: range.from, to: range.to };
  },
  selectRange: (from, to, options) => {
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    if (options?.focus !== false) view.focus();
  },
  replaceRange: (from, to, insert) => {
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
    view.focus();
  },
  replaceRanges: (ranges, insert) => {
    if (ranges.length === 0) return;
    view.dispatch({
      changes: ranges.map(({ from, to }) => ({ from, to, insert })),
      selection: { anchor: ranges[0].from + insert.length },
      scrollIntoView: true,
    });
    view.focus();
  },
  setHighlights: (matches, activeIndex) => {
    view.dispatch({ effects: setFindHighlights.of({ matches, activeIndex }) });
  },
  clearHighlights: () => {
    view.dispatch({ effects: clearFindHighlights.of(undefined) });
  },
});
async function restore(): Promise<void> {
  const res = await commands.loadSettings();
  const s = res.status === "ok" ? res.data : { theme: null, lastFolder: null, openTabs: [], locale: null, editorWidth: null, editorMode: null, sidebarWidth: null };
  document.documentElement.setAttribute("data-theme", s.theme === "light" || s.theme === "dark" ? s.theme : (prefersDark() ? "dark" : "light"));
  document.documentElement.setAttribute("data-editor-width", s.editorWidth === "wide" ? "wide" : "readable");
  editorMode = normalizeEditorMode(s.editorMode);
  document.documentElement.setAttribute("data-editor-mode", editorMode);
  layoutModeControl?.setMode(editorMode);
  syncEditorLayout();
  bindSplitPreviewScroll();
  applySidebarWidth(typeof s.sidebarWidth === "number" ? s.sidebarWidth : SIDEBAR_DEFAULT, false);

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
  layoutModeControl?.relabel();

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
  void checkForUpdates(false);
}

const banner = mountConflictBanner(document.getElementById("main-col")!, {
  onReload: () => void reloadActive(),
  onKeep: () => {},
});
const errorBanner = mountErrorBanner(document.getElementById("main-col")!);
const updateBanner = mountUpdateBanner(document.getElementById("main-col")!);
const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const RELEASES_URL = "https://github.com/JangHyun-bin/Rune/releases/latest";

let updateChecking = false;
async function checkForUpdates(manual: boolean): Promise<void> {
  if (updateChecking) return;
  updateChecking = true;
  try {
    const update = await check();
    if (!update) { if (manual) settingsPanel.setUpdateStatus(tr("update.upToDate")); return; }
    if (manual) settingsPanel.setUpdateStatus("");
    if (manual) settingsPanel.close();
    if (isMacPlatform) {
      updateBanner.showManual(update.version, () => void openUrl(RELEASES_URL));
    } else {
      updateBanner.showAuto(update.version, () => void (async () => {
        updateBanner.setDownloading();
        try {
          await update.downloadAndInstall(() => {});
          await relaunch();
        } catch (e) { console.error(e); updateBanner.hide(); errorBanner.show(tr("update.installFailed")); }
      })());
    }
  } catch (e) {
    console.error(e);
    if (manual) settingsPanel.setUpdateStatus(tr("update.failed"));
  } finally {
    updateChecking = false;
  }
}

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
view = createEditorView(syncEditorLayout(), editorState("", onChange, extraExts(), editorMode));
bindSplitPreviewScroll();
void restore();

window.addEventListener("blur", () => auto.flush());
window.addEventListener("resize", () => applySidebarWidth(currentSidebarWidth(), false));
window.addEventListener("keydown", (e) => {
  if (e.key === "F1") { e.preventDefault(); helpPanel.toggle(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); searchPanel.toggle(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); findReplacePanel?.open(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); flipEditorWidth(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); flipEditorMode(); return; }
  if (mod && e.key === "Tab") { e.preventDefault(); const id = e.shiftKey ? prevTabId(tabs) : nextTabId(tabs); if (id) switchTo(id); return; }
  if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); const id = nthTabId(tabs, Number(e.key)); if (id) switchTo(id); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newDoc(); return; }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (tabs.activeId) requestClose(tabs.activeId); return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); void exportHtml(view.state.doc.toString(), exportTitle()); return; }
});
