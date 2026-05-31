import { EditorView } from "@codemirror/view";

/** Calls save() after delay(ms) of inactivity. ext is a CM6 extension, flush saves immediately. */
export function autosave(delay: number, save: () => void) {
  let timer: number | undefined;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(save, delay);
  };
  const flush = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    save();
  };
  const ext = EditorView.updateListener.of((u) => { if (u.docChanged) schedule(); });
  return { ext, flush };
}
