import { EditorView } from "@codemirror/view";
import { commands } from "../ipc/bindings";
import { getDocPath } from "./docContext";
import { t } from "../i18n/i18n";

function extFromType(type: string): string {
  const m = /image\/(\w+)/.exec(type);
  return m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "png";
}

async function handleFile(view: EditorView, file: File) {
  const docPath = getDocPath();
  if (!docPath) { alert(t("image.saveFirst")); return; }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const res = await commands.saveAsset(docPath, bytes, extFromType(file.type));
  if (res.status === "error") { console.error(res.error); return; }
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: `![](${res.data})` }, selection: { anchor: pos + 2 } });
}

export const imagePaste = EditorView.domEventHandlers({
  paste(e, view) {
    const items = e.clipboardData?.items;
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); void handleFile(view, f); return true; }
      }
    }
    return false;
  },
  drop(e, view) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return false;
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return false;
    e.preventDefault();
    for (const f of imgs) void handleFile(view, f);
    return true;
  },
});
