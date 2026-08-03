import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export interface WritingModes { focus: boolean; typewriter: boolean; }

export function focusedParagraphLines(doc: Text, head: number): { fromLine: number; toLine: number } {
  const current = doc.lineAt(head);
  if (!current.text.trim()) return { fromLine: current.number, toLine: current.number };

  let fromLine = current.number;
  let toLine = current.number;
  while (fromLine > 1 && doc.line(fromLine - 1).text.trim()) fromLine -= 1;
  while (toLine < doc.lines && doc.line(toLine + 1).text.trim()) toLine += 1;
  return { fromLine, toLine };
}

function focusDecorations(view: EditorView, enabled: boolean): DecorationSet {
  if (!enabled) return Decoration.none;
  const { fromLine, toLine } = focusedParagraphLines(view.state.doc, view.state.selection.main.head);
  const lines = [];
  for (let number = fromLine; number <= toLine; number += 1) {
    lines.push(Decoration.line({ class: "cm-focus-paragraph" }).range(view.state.doc.line(number).from));
  }
  return Decoration.set(lines, true);
}

export function writingModesExtension(getModes: () => WritingModes): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private modes: WritingModes;
    private centerFrame = 0;

    constructor(private view: EditorView) {
      this.modes = getModes();
      this.decorations = focusDecorations(view, this.modes.focus);
      if (this.modes.typewriter) this.centerCursor();
    }

    update(update: ViewUpdate): void {
      const next = getModes();
      if (next.focus !== this.modes.focus || update.docChanged || update.selectionSet) {
        this.decorations = focusDecorations(update.view, next.focus);
      }
      const shouldCenter = next.typewriter && !update.view.composing
        && (!this.modes.typewriter || update.selectionSet);
      this.modes = next;
      if (shouldCenter) this.centerCursor();
    }

    destroy(): void {
      if (this.centerFrame) cancelAnimationFrame(this.centerFrame);
    }

    private centerCursor(): void {
      if (this.centerFrame) return;
      this.centerFrame = requestAnimationFrame(() => {
        this.centerFrame = 0;
        if (!getModes().typewriter || !this.view.dom.isConnected) return;
        this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: "center" }) });
      });
    }
  }, { decorations: (plugin) => plugin.decorations });
}
