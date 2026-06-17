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
import { horizontalRuleSpec } from "./horizontalRule";
import { mermaidSpec } from "./mermaid";
import { tableSpec } from "./table";
import { mathField } from "./math";
import { getDocPath as defaultGetDocPath } from "./docContext";
import { imagePasteFor, type ImagePasteContext } from "./paste";
import { imagePreview } from "./image";
import { markdownShortcutKeymap } from "./markdownCommands";

export type EditorMode = "preview" | "source" | "split";
export type EditorDocPathProvider = ImagePasteContext["getDocPath"];

function modeExtensions(mode: EditorMode): Extension[] {
  if (mode === "source" || mode === "split") return [];
  return [
    livePreview,
    blockWidgets([horizontalRuleSpec, mermaidSpec, tableSpec]),
    mathField(),
    imagePreview(),
  ];
}

/** 탭별 EditorState를 만든다. 내용이 바뀌면 onChange(text)를 호출한다. extraExtensions로 추가 확장 주입 가능. */
export function editorState(
  doc: string,
  onChange: (text: string) => void,
  extraExtensions: Extension[] = [],
  mode: EditorMode = "preview",
  getDocPath: EditorDocPathProvider = defaultGetDocPath,
): EditorState {
  const imagePasteExtension = imagePasteFor({ getDocPath });
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      markdownShortcutKeymap(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      editorTheme(),
      EditorView.lineWrapping,
      syntaxHighlighting(codeHighlightStyle),
      ...modeExtensions(mode),
      imagePasteExtension,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      ...extraExtensions,
    ],
  });
}

/** EditorState를 parent에 마운트한 EditorView를 만든다. */
export function createEditorView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent });
}

/** 마운트하고, 내용이 바뀔 때마다 onChange(text)를 호출한다. extraExtensions로 추가 확장 주입 가능. */
export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (text: string) => void,
  extraExtensions: Extension[] = [],
  mode: EditorMode = "preview",
  getDocPath: EditorDocPathProvider = defaultGetDocPath,
): EditorView {
  return createEditorView(parent, editorState(doc, onChange, extraExtensions, mode, getDocPath));
}

/** 에디터 전체 내용을 text로 교체(파일 열기 시). */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
