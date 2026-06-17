import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commands } from "../ipc/bindings";
import { getDocPath } from "./docContext";
import { t } from "../i18n/i18n";

export interface ImagePasteContext {
  getDocPath: () => string | null;
}

function extFromType(type: string): string {
  const m = /image\/(\w+)/.exec(type);
  return m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "png";
}

async function handleFiles(view: EditorView, files: File[], getDocPath: ImagePasteContext["getDocPath"]) {
  const originState = view.state;
  let expectedState = originState;
  let insertPos = originState.selection.main.head;
  const docPath = getDocPath();
  if (!docPath) { alert(t("image.saveFirst")); return; }

  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const res = await commands.saveAsset(docPath, bytes, extFromType(file.type));
    if (res.status === "error") { console.error(res.error); continue; }
    if (view.state !== expectedState) return;

    const markdown = `![](${res.data})`;
    view.dispatch({ changes: { from: insertPos, insert: markdown }, selection: { anchor: insertPos + 2 } });
    insertPos += markdown.length;
    expectedState = view.state;
  }
}

export function imagePasteFor(context: ImagePasteContext): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const items = e.clipboardData?.items;
      if (!items) return false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); void handleFiles(view, [f], context.getDocPath); return true; }
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
      void handleFiles(view, imgs, context.getDocPath);
      return true;
    },
  });
}

export const imagePaste = imagePasteFor({ getDocPath });
