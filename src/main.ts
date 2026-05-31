import "./styles.css";
import { editorState, createEditorView } from "./editor/editor";
import { type TabsState, emptyTabs, activeTab, openOrFocus, newUntitled, setActive, updateActiveText, markActiveSaved, closeTab, tabDirty } from "./workspace/tabs";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { mountChrome } from "./chrome/chrome";
import { setDocPath } from "./editor/docContext";
import { mountFileTree } from "./workspace/fileTree";
import { mountTabBar } from "./workspace/tabBar";
import { autosave } from "./workspace/autosave";

const chrome = mountChrome(document.getElementById("titlebar")!, document.getElementById("statusbar")!);
const tree = mountFileTree(document.getElementById("sidebar")!, (p) => void openPath(p));
const tabBar = mountTabBar(document.getElementById("tabbar")!, { onSelect: switchTo, onClose: requestClose });

let tabs: TabsState = emptyTabs();
const states = new Map<string, EditorState>();
let view: EditorView;
const auto = autosave(800, () => void autoSave());

function baseName(p: string): string { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; }
function extraExts() { return [EditorView.updateListener.of((u) => { if (u.selectionSet) refreshStatus(); }), auto.ext]; }
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
}
async function openPath(path: string): Promise<void> {
  const existing = tabs.tabs.find((t) => t.path === path);
  if (existing) { switchTo(existing.id); return; }
  const res = await commands.readFile(path);
  if (res.status === "error") { console.error(res.error); return; }
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = openOrFocus(tabs, path, res.data);
  showActive();
}
function newDoc(): void {
  if (tabs.activeId && view) states.set(tabs.activeId, view.state);
  tabs = newUntitled(tabs);
  showActive();
}
async function openFile(): Promise<void> {
  const selected = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
  if (typeof selected === "string") await openPath(selected);
}
async function openFolder(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  const res = await commands.listDir(dir);
  if (res.status === "error") { console.error(res.error); return; }
  tree.render(res.data);
}
function requestClose(id: string): void {
  const t = tabs.tabs.find((x) => x.id === id);
  if (t && tabDirty(t) && !confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return;
  if (tabs.activeId && view && tabs.activeId !== id) states.set(tabs.activeId, view.state);
  states.delete(id);
  tabs = closeTab(tabs, id);
  if (!tabs.activeId) tabs = newUntitled(tabs);
  showActive();
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

// init: one empty tab + the editor view
tabs = newUntitled(tabs);
const firstState = editorState("", onChange, extraExts());
states.set(tabs.activeId!, firstState);
view = createEditorView(document.getElementById("editor")!, firstState);
syncActiveUI();

window.addEventListener("blur", () => auto.flush());
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newDoc(); return; }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (tabs.activeId) requestClose(tabs.activeId); return; }
});
