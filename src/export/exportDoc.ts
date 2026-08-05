import { renderBody } from "./render";
import { commands } from "../ipc/bindings";
import { save } from "@tauri-apps/plugin-dialog";
import katexCss from "katex/dist/katex.min.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export interface HtmlDocumentOptions {
  theme?: "default" | "serif";
  pageSize?: "A4" | "Letter";
  margins?: { top: number; right: number; bottom: number; left: number };
  pageBreakDocuments?: boolean;
  metadata?: { author?: string; subject?: string };
}

function safeMargin(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(5, Math.min(50, value as number)) : fallback;
}

function meta(name: string, value: string | undefined): string {
  return value?.trim() ? `<meta name="${name}" content="${escapeHtml(value.trim()).replace(/"/g, "&quot;")}">` : "";
}

export function buildHtmlDocument(title: string, body: string, options: HtmlDocumentOptions = {}): string {
  const margins = options.margins ?? { top: 18, right: 18, bottom: 18, left: 18 };
  const family = options.theme === "serif"
    ? "Georgia,'Times New Roman','Noto Serif KR',serif"
    : "'Pretendard Variable',Pretendard,-apple-system,system-ui,'Apple SD Gothic Neo',sans-serif";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${meta("author", options.metadata?.author)}${meta("description", options.metadata?.subject)}
<style>
${katexCss}
${hljsCss}
:root{color-scheme:light}
body{font-family:${family};max-width:760px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1a1a1a;background:#fff}
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
.project-title{margin-bottom:2rem}.project-title>h1{font-size:2rem}
.project-toc{margin:0 0 3rem}.project-toc ol{list-style:none;padding:0}.toc-entry{margin:.25rem 0}.toc-entry a{color:inherit;text-decoration:none}.toc-level-2{padding-left:1rem}.toc-level-3{padding-left:2rem}.toc-level-4{padding-left:3rem}.toc-level-5{padding-left:4rem}.toc-level-6{padding-left:5rem}
.project-document{min-width:0}
@page{size:${options.pageSize ?? "A4"};margin:${safeMargin(margins.top, 18)}mm ${safeMargin(margins.right, 18)}mm ${safeMargin(margins.bottom, 18)}mm ${safeMargin(margins.left, 18)}mm}
@media print{
  body{max-width:none;margin:0;padding:0;color:#000;background:#fff}
  .project-title{break-after:page;page-break-after:always}
  .project-toc{break-after:page;page-break-after:always}
  ${options.pageBreakDocuments === false ? "" : ".project-document:not(:first-of-type){break-before:page;page-break-before:always}"}
  h1,h2,h3,h4{break-after:avoid-page;page-break-after:avoid}
  tr,blockquote,.mermaid,figure,img{break-inside:avoid-page;page-break-inside:avoid}
  table{width:100%;table-layout:auto;break-inside:auto;page-break-inside:auto}pre.hljs{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible}
  img,svg{max-width:100%!important;height:auto!important}img{max-height:90vh!important}.mermaid{overflow:visible}.mermaid svg{max-height:90vh}
  a{color:inherit}.project-toc a{text-decoration:none}
}
</style></head><body><article>${body}</article></body></html>`;
}

export async function saveHtmlDocument(html: string, title: string): Promise<void> {
  const path = await save({ filters: [{ name: "HTML", extensions: ["html"] }], defaultPath: `${title}.html` });
  if (typeof path !== "string") return;
  const res = await commands.writeFile(path, html);
  if (res.status === "error") console.error(res.error);
}

export function showHtmlPreview(html: string, title: string, closeLabel = "Close"): void {
  const overlay = document.createElement("div");
  overlay.className = "project-preview-overlay";
  const dialog = document.createElement("div");
  dialog.className = "project-preview-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const iframe = document.createElement("iframe");
  iframe.className = "project-preview-frame";
  iframe.setAttribute("title", title);
  iframe.srcdoc = html;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-secondary";
  close.textContent = closeLabel;
  close.addEventListener("click", () => overlay.remove());
  dialog.append(heading, iframe, close);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

export async function exportHtml(markdown: string, title: string): Promise<void> {
  const body = await renderBody(markdown);
  const html = buildHtmlDocument(title, body);
  await saveHtmlDocument(html, title);
}

export async function exportPdf(markdown: string, title: string): Promise<void> {
  const body = await renderBody(markdown);
  const html = buildHtmlDocument(title, body);
  await printHtmlDocument(html, title);
}

export async function printHtmlDocument(html: string, title: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.addEventListener("error", () => reject(new Error("Print preview failed to load")), { once: true });
      iframe.srcdoc = html;
    });
    const w = iframe.contentWindow;
    if (!w) throw new Error("Print window is unavailable");
    await iframe.contentDocument?.fonts?.ready;
    const images = [...(iframe.contentDocument?.images ?? [])];
    await Promise.all(images.map((image) => image.complete
      ? image.naturalWidth === 0 ? Promise.reject(new Error("Print image failed to load")) : Promise.resolve()
      : new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("Print image failed to load")), { once: true });
    })));
    w.focus();
    w.print();
    setTimeout(() => iframe.remove(), 1500);
  } catch (error) {
    iframe.remove();
    throw error;
  }
}
