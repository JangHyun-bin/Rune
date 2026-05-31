import MarkdownIt from "markdown-it";
import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js";

// PluginSimple: (md: MarkdownIt) => void
type PluginSimple = (md: MarkdownIt) => void;

// @vscode/markdown-it-katex is a CJS module; when imported as ESM the default
// export is the module namespace object ({ __esModule: true, default: fn }).
// We unwrap to get the actual plugin function.
const katexPluginFn = (
  typeof (katexPlugin as unknown as { default: unknown }).default === "function"
    ? (katexPlugin as unknown as { default: PluginSimple }).default
    : (katexPlugin as unknown as PluginSimple)
) as PluginSimple;

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (str: string, lang: string): string => {
    if (lang && lang !== "mermaid" && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    if (lang === "mermaid")
      return `<pre class="mermaid-src">${md.utils.escapeHtml(str)}</pre>`;
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
}).use(katexPluginFn);

/** 동기 마크다운→HTML (테스트/단순 미리보기용; mermaid 미처리). */
export function mdRender(s: string): string {
  return md.render(s);
}

let mermaidReady = false;
/** 전체 본문 HTML. mermaid 코드블록은 SVG로 비동기 치환. (브라우저 전용) */
export async function renderBody(markdown: string): Promise<string> {
  let html = md.render(markdown);
  const re = /<pre class="mermaid-src">([\s\S]*?)<\/pre>/g;
  const matches = [...html.matchAll(re)];
  if (matches.length > 0) {
    const mermaid = (await import("mermaid")).default;
    if (!mermaidReady) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      mermaidReady = true;
    }
    let seq = 0;
    for (const m of matches) {
      const code = decodeEntities(m[1]);
      try {
        const { svg } = await mermaid.render("exp-" + seq++, code);
        html = html.replace(m[0], `<div class="mermaid">${svg}</div>`);
      } catch {
        html = html.replace(m[0], `<pre>${m[1]}</pre>`);
      }
    }
  }
  return html;
}

function decodeEntities(s: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}
