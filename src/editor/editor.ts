import "../theme/fonts";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { editorTheme } from "../theme/editorTheme";
import { livePreview } from "./livePreview";
import { codeHighlightStyle } from "./highlightStyle";
import { blockWidgets } from "./blockWidgets";
import { mermaidSpec } from "./mermaid";
import { tableSpec } from "./table";
import { mathField } from "./math";
import { imagePaste } from "./paste";

/** 마운트하고, 내용이 바뀔 때마다 onChange(text)를 호출한다. extraExtensions로 추가 확장 주입 가능. */
export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (text: string) => void,
  extraExtensions: Extension[] = [],
): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      editorTheme(),
      syntaxHighlighting(codeHighlightStyle),
      livePreview,
      blockWidgets([mermaidSpec, tableSpec]),
      mathField(),
      imagePaste,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      ...extraExtensions,
    ],
  });
  return new EditorView({ state, parent });
}

/** 에디터 전체 내용을 text로 교체(파일 열기 시). */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
