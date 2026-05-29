import "./styles.css";
import { createEditor, setEditorText } from "./editor/editor";
import {
  newDoc, loadedDoc, withCurrentText, markSaved, isDirty, type DocState,
} from "./doc/document";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";

let docState: DocState = newDoc();

const appEl = document.getElementById("editor")!;
const view = createEditor(appEl, "", (text) => {
  docState = withCurrentText(docState, text);
  updateTitle();
});

function updateTitle(): void {
  const name = docState.path ?? "Untitled";
  document.title = (isDirty(docState) ? "● " : "") + name + " — cp_markdown";
}
updateTitle();

async function openFile(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected !== "string") return;
  const res = await commands.readFile(selected);
  if (res.status === "error") { console.error(res.error); return; }
  docState = loadedDoc(selected, res.data);
  setEditorText(view, res.data);
  updateTitle();
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
}

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveFile(); }
});
