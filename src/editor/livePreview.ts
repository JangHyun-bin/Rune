import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType,
} from "@codemirror/view";
import { t } from "../i18n/i18n";
import { toggledTaskMarker } from "./taskMarker";

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly view: EditorView, readonly from: number, readonly to: number) { super(); }
  eq(o: TaskWidget) { return o.checked === this.checked && o.from === this.from && o.to === this.to; }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-task";
    box.setAttribute("aria-label", this.checked ? t("aria.taskDone") : t("aria.taskTodo"));
    box.addEventListener("mousedown", (e) => {
      // from/to are current: decorations rebuild synchronously on every docChanged,
      // so the in-DOM widget always reflects the live doc; re-read the slice to toggle.
      e.preventDefault();
      const cur = this.view.state.doc.sliceString(this.from, this.to);
      this.view.dispatch({ changes: { from: this.from, to: this.to, insert: toggledTaskMarker(cur) } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

// 커서가 그 줄에 없을 때 숨길 마커 노드들.
const HIDDEN_MARKS = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "QuoteMark", "LinkMark",
]);
// 렌더 콘텐츠에 입힐 스타일 클래스.
const NODE_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-code",
};

function activeLines(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

function build(view: EditorView): { deco: DecorationSet; atomic: DecorationSet } {
  const decoR: Range<Decoration>[] = [];
  const atomicR: Range<Decoration>[] = [];
  const active = activeLines(view);
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;

        const h = /^ATXHeading([1-6])$/.exec(name);
        if (h) {
          const line = doc.lineAt(node.from);
          decoR.push(Decoration.line({ class: `cm-md-h${h[1]}` }).range(line.from));
          return;
        }
        if (name === "FencedCode") {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let ln = first; ln <= last; ln++) {
            decoR.push(Decoration.line({ class: "cm-md-codeblock" }).range(doc.line(ln).from));
          }
          return;
        }
        if (name === "Blockquote") {
          const first = doc.lineAt(node.from).number;
          // Blockquote node.to ends at the last content char (no trailing \n); -1 + Math.max
          // guards doc.lineAt from landing on the next line / underflowing a 0-length node.
          const last = doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let ln = first; ln <= last; ln++) {
            decoR.push(Decoration.line({ class: "cm-md-quote" }).range(doc.line(ln).from));
          }
          return;
        }
        if (name === "TaskMarker") {
          const lineNo = doc.lineAt(node.from).number;
          if (active.has(lineNo)) return;
          const checked = /\[[xX]\]/.test(doc.sliceString(node.from, node.to));
          const w = Decoration.replace({ widget: new TaskWidget(checked, view, node.from, node.to) });
          decoR.push(w.range(node.from, node.to));
          atomicR.push(w.range(node.from, node.to));
          return;
        }
        if (name === "ListMark") {
          const lineNo = doc.lineAt(node.from).number;
          if (active.has(lineNo)) return;
          const li = node.node.parent;            // ListItem
          const isTask = !!li?.getChild("Task");
          const inBullet = li?.parent?.name === "BulletList";
          if (isTask) {
            const hide = Decoration.replace({});
            decoR.push(hide.range(node.from, node.to));
            atomicR.push(hide.range(node.from, node.to));
            return;
          }
          if (inBullet) {
            const w = Decoration.replace({ widget: new BulletWidget() });
            decoR.push(w.range(node.from, node.to));
            atomicR.push(w.range(node.from, node.to));
          }
          return;
        }
        if (name === "Link") {
          decoR.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
          return; // children (LinkMark, URL) are still visited below
        }
        if (name === "URL") {
          const lineNo = doc.lineAt(node.from).number;
          const inLink = node.node.parent?.name === "Link";
          if (inLink && !active.has(lineNo)) {
            const hide = Decoration.replace({});
            decoR.push(hide.range(node.from, node.to));
            atomicR.push(hide.range(node.from, node.to));
          } else {
            decoR.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
          }
          return;
        }
        if (name === "LinkLabel") {
          decoR.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
          return;
        }
        if (name === "LinkTitle") {
          const lineNo = doc.lineAt(node.from).number;
          if (!active.has(lineNo)) {
            const hide = Decoration.replace({});
            decoR.push(hide.range(node.from, node.to));
            atomicR.push(hide.range(node.from, node.to));
          }
          return;
        }
        const cls = NODE_CLASS[name];
        if (cls) {
          decoR.push(Decoration.mark({ class: cls }).range(node.from, node.to));
          return;
        }
        if (HIDDEN_MARKS.has(name) && node.to > node.from) {
          const lineNo = doc.lineAt(node.from).number;
          if (!active.has(lineNo)) {
            const hide = Decoration.replace({});
            decoR.push(hide.range(node.from, node.to));
            atomicR.push(hide.range(node.from, node.to));
          }
        }
      },
    });
  }
  const cmp = (a: Range<Decoration>, b: Range<Decoration>) =>
    a.from - b.from || a.value.startSide - b.value.startSide;
  decoR.sort(cmp);
  atomicR.sort(cmp);
  return { deco: Decoration.set(decoR, true), atomic: Decoration.set(atomicR, true) };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      const r = build(view);
      this.deco = r.deco;
      this.atomic = r.atomic;
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        const r = build(u.view);
        this.deco = r.deco;
        this.atomic = r.atomic;
      }
    }
  },
  {
    decorations: (v) => v.deco,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
      ),
  },
);
