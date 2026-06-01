import mermaid from "mermaid";
import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";
import { t } from "../i18n/i18n";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

function isMermaidFence(state: EditorState, name: string, from: number): boolean {
  if (name !== "FencedCode") return false;
  const firstLine = state.doc.lineAt(from).text.trim();
  return /^(`{3,}|~{3,})\s*mermaid\b/.test(firstLine);
}

function innerCode(source: string): string {
  const lines = source.split("\n");
  let body = lines.slice(1); // drop opening fence line
  if (body.length && /^(```|~~~)/.test(body[body.length - 1].trim())) body = body.slice(0, -1);
  return body.join("\n");
}

let seq = 0;
export const mermaidSpec: BlockSpec = {
  match: (state, name, from) => isMermaidFence(state, name, from),
  key: (source) => "mermaid:" + source,
  render: (source) => {
    const el = document.createElement("div");
    el.className = "cm-mermaid";
    const id = "mmd-" + seq++;
    mermaid
      .render(id, innerCode(source))
      .then(({ svg }) => { el.innerHTML = svg; })
      .catch((err) => {
        el.className = "cm-mermaid-error";
        el.textContent = t("error.mermaid", { msg: err?.message ?? String(err) });
      });
    return el;
  },
};
