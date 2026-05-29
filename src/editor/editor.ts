import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

/** 마운트하고, 내용이 바뀔 때마다 onChange(text)를 호출하는 뷰를 만든다. */
export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (text: string) => void,
): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}

/** 에디터 전체 내용을 text로 교체한다(파일 열기 시). */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
