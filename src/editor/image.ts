import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getDocDir } from "./docContext";
import { makePreviewWidgetInert, selectionInsideSource } from "./previewWidget";

function urlFromImageNode(state: EditorState, from: number, to: number): string | null {
  const text = state.doc.sliceString(from, to);
  const m = /\]\(([^)]+)\)/.exec(text); // ![alt](url)
  return m ? m[1].trim() : null;
}

function resolveSrc(url: string): string {
  if (/^(https?:|data:|asset:)/.test(url)) return url;
  const dir = getDocDir();
  if (!dir) return url;
  const sep = dir.includes("\\") ? "\\" : "/";
  return convertFileSrc(dir + sep + url.replace(/\//g, sep));
}

function isResolvable(url: string): boolean {
  if (/^(https?:|data:|asset:)/.test(url)) return true;
  return getDocDir() !== null;
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly resolvable: boolean) { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt && o.resolvable === this.resolvable; }
  toDOM(view: EditorView) {
    if (!this.resolvable) {
      const ph = document.createElement("span");
      ph.className = "cm-md-image-missing";
      ph.textContent = this.alt || this.src;
      return makePreviewWidgetInert(ph);
    }
    const img = document.createElement("img");
    img.className = "cm-md-image";
    img.src = this.src;
    img.alt = this.alt;
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => view.requestMeasure());
    return makePreviewWidgetInert(img);
  }
  ignoreEvent() { return true; }
}

function build(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Image") return;
      if (selectionInsideSource(state, node.from, node.to)) return;
      const url = urlFromImageNode(state, node.from, node.to);
      if (!url) return;
      const altM = /!\[([^\]]*)\]/.exec(state.doc.sliceString(node.from, node.to));
      const resolvable = isResolvable(url);
      b.add(node.from, node.to, Decoration.replace({ widget: new ImageWidget(resolveSrc(url), altM?.[1] ?? "", resolvable) }));
    },
  });
  return b.finish();
}

export function imagePreview(): Extension {
  return StateField.define<DecorationSet>({
    create: (s) => build(s),
    update: (d, tr) => (tr.docChanged || tr.selection ? build(tr.state) : d),
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f)),
    ],
  });
}
