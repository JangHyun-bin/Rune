import { EditorView } from "@codemirror/view";

/** Minimal/Cool 에디터 테마. 색은 CSS 변수에서 가져와 라이트/다크 자동 추종. */
export function editorTheme() {
  return EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-scroller": { fontFamily: "var(--sans)", fontSize: "16px", lineHeight: "1.7", overflow: "auto" },
    ".cm-content": { maxWidth: "var(--editor-max, 720px)", margin: "0 auto", padding: "32px 28px" },
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
    ".cm-md-code": { fontFamily: "var(--mono)", fontSize: "0.9em", background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.05em 0.35em" },
    ".cm-md-quote": { color: "var(--muted)", borderLeft: "3px solid var(--border)", paddingLeft: "0.8em" },
    ".cm-md-link": { color: "var(--accent)", textDecoration: "underline" },
    ".cm-md-codeblock": { fontFamily: "var(--mono)", fontSize: "0.92em", background: "var(--faint)", borderRadius: "var(--radius-sm)" },
    ".cm-block-widget": { margin: "0.5em 0" },
    ".cm-mermaid": { display: "flex", justifyContent: "center", padding: "10px", background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" },
    ".cm-mermaid-error": { color: "var(--accent)", fontFamily: "var(--mono)", fontSize: "0.85em", padding: "10px", whiteSpace: "pre-wrap" },
    ".cm-math-block": { display: "block", textAlign: "center", margin: "0.6em 0" },
    ".cm-math-inline": { padding: "0 0.1em" },
    ".cm-md-table": { borderCollapse: "collapse", width: "100%", fontSize: "0.95em" },
    ".cm-md-table th, .cm-md-table td": { border: "1px solid var(--border)", padding: "6px 10px", textAlign: "left" },
    ".cm-md-table th": { background: "var(--faint)", fontWeight: "700" },
    ".cm-md-image": { maxWidth: "100%", borderRadius: "var(--radius-md)", display: "block", margin: "0.4em 0" },
  });
}
