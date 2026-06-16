import { renderBody } from "./render";
import { commands } from "../ipc/bindings";
import { save } from "@tauri-apps/plugin-dialog";
import katexCss from "katex/dist/katex.min.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function buildHtml(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
${katexCss}
${hljsCss}
:root{color-scheme:light}
body{font-family:'Pretendard Variable',Pretendard,-apple-system,system-ui,'Apple SD Gothic Neo',sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1a1a1a;background:#fff}
h1,h2,h3,h4{line-height:1.25}
pre.hljs{background:#f6f8fa;padding:12px 14px;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
table{border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px 10px;text-align:left} th{background:#f6f8fa}
blockquote{border-left:3px solid #ddd;color:#666;padding-left:1em;margin-left:0}
blockquote.callout{border:1px solid #d0d7de;border-left-width:4px;border-radius:8px;color:#24292f;background:#f6f8fa;padding:12px 14px;margin:1em 0}
blockquote.callout::before{content:attr(data-callout-title);display:block;font-weight:700;margin-bottom:.35em}
blockquote.callout-note{border-left-color:#0969da}
blockquote.callout-tip{border-left-color:#1a7f37}
blockquote.callout-important{border-left-color:#8250df}
blockquote.callout-warning{border-left-color:#9a6700}
blockquote.callout-caution{border-left-color:#cf222e}
.footnote-ref a{text-decoration:none}
.footnotes{border-top:1px solid #d0d7de;margin-top:2em;padding-top:1em;font-size:.9em;color:#57606a}
.footnotes ol{padding-left:1.5em}
.footnote-backref{text-decoration:none;margin-left:.25em}
.mermaid{display:flex;justify-content:center;margin:1em 0}
img{max-width:100%}
</style></head><body><article>${body}</article></body></html>`;
}

export async function exportHtml(markdown: string, title: string): Promise<void> {
  const body = await renderBody(markdown);
  const html = buildHtml(title, body);
  const path = await save({ filters: [{ name: "HTML", extensions: ["html"] }], defaultPath: `${title}.html` });
  if (typeof path !== "string") return;
  const res = await commands.writeFile(path, html);
  if (res.status === "error") console.error(res.error);
}

export async function exportPdf(markdown: string, title: string): Promise<void> {
  const body = await renderBody(markdown);
  const html = buildHtml(title, body);
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.addEventListener("load", () => {
    const w = iframe.contentWindow;
    if (w) { w.focus(); w.print(); }
    setTimeout(() => iframe.remove(), 1500);
  });
}
