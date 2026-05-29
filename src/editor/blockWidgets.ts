import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface BlockSpec {
  match(state: EditorState, nodeName: string, from: number, to: number): boolean;
  render(source: string): HTMLElement;
  key(source: string): string;
}

class BlockWidget extends WidgetType {
  constructor(readonly spec: BlockSpec, readonly source: string) { super(); }
  eq(other: BlockWidget) {
    return other.spec === this.spec && this.spec.key(this.source) === other.spec.key(other.source);
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-block-widget";
    wrap.appendChild(this.spec.render(this.source));
    return wrap;
  }
  ignoreEvent() { return false; }
}

function cursorInside(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.to >= from && r.from <= to) return true;
  return false;
}

function buildFor(state: EditorState, specs: BlockSpec[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      for (const spec of specs) {
        if (spec.match(state, node.name, node.from, node.to)) {
          if (cursorInside(state, node.from, node.to)) return;
          const source = state.doc.sliceString(node.from, node.to);
          b.add(node.from, node.to, Decoration.replace({ widget: new BlockWidget(spec, source), block: true }));
          return;
        }
      }
    },
  });
  return b.finish();
}

/** 여러 BlockSpec을 하나의 StateField 확장으로. */
export function blockWidgets(specs: BlockSpec[]): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildFor(state, specs),
    update: (deco, tr) => (tr.docChanged || tr.selection ? buildFor(tr.state, specs) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
