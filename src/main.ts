import "./styles.css";
import { createEditor, setEditorText } from "./editor/editor";
import {
  newDoc, loadedDoc, withCurrentText, markSaved, isDirty, type DocState,
} from "./doc/document";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";
import { EditorView } from "@codemirror/view";
import { mountChrome } from "./chrome/chrome";
import { setDocPath } from "./editor/docContext";

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

view = createEditor(
  document.getElementById("editor")!,
  "",
  (text) => {
    docState = withCurrentText(docState, text);
    updateTitle();
    refreshStatus();
  },
  [EditorView.updateListener.of((u) => { if (u.selectionSet) refreshStatus(); })],
);

updateTitle();
refreshStatus();

async function openFile(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected !== "string") return;
  const res = await commands.readFile(selected);
  if (res.status === "error") { console.error(res.error); return; }
  docState = loadedDoc(selected, res.data);
  setDocPath(docState.path);
  setEditorText(view, res.data);
  updateTitle();
  refreshStatus();
}

async function saveFile(): Promise<void> {
  let path = docState.path;
  if (!path) {
    const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof chosen !== "string") return;
    path = chosen;
  }
  const res = await commands.writeFile(path, docState.currentText);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSaved({ ...docState, path });
  updateTitle();
  refreshStatus();
}

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveFile(); }
});
