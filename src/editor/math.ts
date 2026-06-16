import katex from "katex";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isInlineMath } from "./mathSpan";
import { makePreviewWidgetInert, selectionInsideSource } from "./previewWidget";

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly block: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.block === this.block; }
  toDOM() {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = this.block ? "cm-math-block" : "cm-math-inline";
    try {
      el.innerHTML = katex.renderToString(this.tex, { displayMode: this.block, throwOnError: false });
    } catch {
      el.textContent = this.tex;
    }
    return makePreviewWidgetInert(el);
  }
  ignoreEvent() { return true; }
}

const BLOCK_RE = /\$\$([^$]+?)\$\$/g;
const INLINE_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

function codeRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeText") {
        ranges.push({ from: n.from, to: n.to });
      }
    },
  });
  return ranges;
}

function inCode(ranges: { from: number; to: number }[], from: number, to: number): boolean {
  return ranges.some((r) => from < r.to && to > r.from);
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const code = codeRanges(state);
  const found: { from: number; to: number; deco: Decoration }[] = [];
  for (const m of text.matchAll(BLOCK_RE)) {
    const from = m.index!, to = from + m[0].length;
    if (inCode(code, from, to)) continue;
    if (!selectionInsideSource(state, from, to)) {
      found.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(m[1].trim(), true), block: true }) });
    }
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const from = m.index!, to = from + m[0].length;
    if (inCode(code, from, to)) continue;
    if (!isInlineMath(m[1])) continue;
    if (!selectionInsideSource(state, from, to)) {
      found.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(m[1].trim(), false) }) });
    }
  }
  found.sort((a, b) => a.from - b.from);
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const r of found) {
    if (r.from >= last) { b.add(r.from, r.to, r.deco); last = r.to; }
  }
  return b.finish();
}

export function mathField(): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state) : deco),
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
}
