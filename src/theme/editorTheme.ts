import { EditorView } from "@codemirror/view";

/** Minimal/Cool 에디터 테마. 색은 CSS 변수에서 가져와 라이트/다크 자동 추종. */
export function editorTheme() {
  return EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-scroller": { fontFamily: "var(--sans)", fontSize: "16px", lineHeight: "1.7", overflow: "auto" },
    ".cm-content": { maxWidth: "720px", margin: "0 auto", padding: "32px 28px" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    ".cm-selectionBackground": { backgroundColor: "var(--accent-soft)" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent-soft)" },
    ".cm-md-h1": { fontSize: "1.9em", fontWeight: "700", lineHeight: "1.25" },
    ".cm-md-h2": { fontSize: "1.55em", fontWeight: "700", lineHeight: "1.3" },
    ".cm-md-h3": { fontSize: "1.3em", fontWeight: "700" },
    ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontSize: "1.1em", fontWeight: "700" },
    ".cm-md-strong": { fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strike": { textDecoration: "line-through", color: "var(--muted)" },
    ".cm-md-code": { fontFamily: "var(--mono)", fontSize: "0.9em", background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.05em 0.35em" },
    ".cm-md-quote": { color: "var(--muted)", borderLeft: "3px solid var(--border)", paddingLeft: "0.8em" },
    ".cm-md-link": { color: "var(--accent)", textDecoration: "underline" },
    ".cm-md-codeblock": { fontFamily: "var(--mono)", fontSize: "0.92em", background: "var(--faint)" },
  });
}
