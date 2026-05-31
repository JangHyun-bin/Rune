import "./styles.css";
import { createEditor, setEditorText } from "./editor/editor";
import {
  newDoc, loadedDoc, withCurrentText, markSavedAs, isDirty, type DocState,
} from "./doc/document";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorView } from "@codemirror/view";
import { mountChrome } from "./chrome/chrome";
import { setDocPath } from "./editor/docContext";
import { mountFileTree } from "./workspace/fileTree";
import { autosave } from "./workspace/autosave";

let docState: DocState = newDoc();

const chrome = mountChrome(
  document.getElementById("titlebar")!,
  document.getElementById("statusbar")!,
);

let view: EditorView;

function updateTitle(): void {
  setDocPath(docState.path);
  const name = docState.path ?? "Untitled";
  document.title = (isDirty(docState) ? "● " : "") + name + " — cp_markdown";
  chrome.setTitle(name, isDirty(docState));
}

function refreshStatus(): void {
  if (!view) return;
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  chrome.setStatus(text, line.number, head - line.from + 1);
}

const auto = autosave(800, () => void autoSave());

view = createEditor(
  document.getElementById("editor")!,
  "",
  (text) => {
    docState = withCurrentText(docState, text);
    updateTitle();
    refreshStatus();
  },
  [EditorView.updateListener.of((u) => { if (u.selectionSet) refreshStatus(); }), auto.ext],
);

const tree = mountFileTree(document.getElementById("sidebar")!, (p) => void openPath(p));

updateTitle();
refreshStatus();

async function openPath(path: string): Promise<void> {
  if (isDirty(docState) && !confirm("저장하지 않은 변경이 있습니다. 버리고 열까요?")) return;
  const res = await commands.readFile(path);
  if (res.status === "error") { console.error(res.error); return; }
  docState = loadedDoc(path, res.data);
  setDocPath(docState.path);
  setEditorText(view, res.data);
  updateTitle();
  refreshStatus();
  tree.setActive(path);
}

async function openFile(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected !== "string") return;
  await openPath(selected);
}

async function doSave(): Promise<void> {
  let path = docState.path;
  if (!path) {
    const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof chosen !== "string") return;
    path = chosen;
  }
  const text = docState.currentText;                 // snapshot at save time
  const res = await commands.writeFile(path, text);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSavedAs(docState, path, text);
  setDocPath(path); updateTitle(); refreshStatus();
}

async function autoSave(): Promise<void> {
  if (!docState.path || !isDirty(docState)) return;
  const text = docState.currentText;
  const res = await commands.writeFile(docState.path, text);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSavedAs(docState, docState.path, text);
  updateTitle(); refreshStatus();
}

async function openFolder(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  const res = await commands.listDir(dir);
  if (res.status === "error") { console.error(res.error); return; }
  tree.render(res.data);
}

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); }
  else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); }
});

window.addEventListener("blur", () => auto.flush());
