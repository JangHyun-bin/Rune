import MarkdownIt from "markdown-it";
import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js";
import { markdownHeadingSlug } from "../editor/markdownLinks";

// PluginSimple: (md: MarkdownIt) => void
type PluginSimple = (md: MarkdownIt) => void;

interface FootnoteDefinition {
  label: string;
  id: string;
  content: string;
}

interface RuneRenderEnv {
  footnotesByLabel?: Map<string, FootnoteDefinition>;
  footnoteOrder?: string[];
  footnoteNumbers?: Map<string, number>;
  footnoteRefCounts?: Map<string, number>;
  footnoteBackrefs?: Map<string, string[]>;
  idPrefix?: string;
  headingCounts?: Map<string, number>;
  rewriteHref?: (href: string, kind: "link" | "image") => string;
}

export interface RenderOptions {
  idPrefix?: string;
  rewriteHref?: (href: string, kind: "link" | "image") => string;
}

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

md.use(calloutPlugin);
md.use(footnoteRefPlugin);
installProjectRenderRules(md);

/** 동기 마크다운→HTML (테스트/단순 미리보기용; mermaid 미처리). */
export function mdRender(s: string, options: RenderOptions = {}): string {
  const { markdown, footnotes } = prepareMarkdown(s);
  const env = createRenderEnv(footnotes, options);
  return appendFootnotes(md.render(markdown, env), env);
}

let mermaidReady = false;
/** 전체 본문 HTML. mermaid 코드블록은 SVG로 비동기 치환. (브라우저 전용) */
export async function renderBody(markdown: string, options: RenderOptions = {}): Promise<string> {
  let html = mdRender(markdown, options);
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
        const renderId = `exp-${(options.idPrefix ?? "").replace(/[^A-Za-z0-9_-]/g, "-")}${seq++}`;
        const { svg } = await mermaid.render(renderId, code);
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

function prepareMarkdown(source: string): { markdown: string; footnotes: FootnoteDefinition[] } {
  return extractFootnotes(stripFrontMatter(source));
}

function stripFrontMatter(source: string): string {
  const hasBom = source.charCodeAt(0) === 0xfeff;
  const body = hasBom ? source.slice(1) : source;
  const lines = body.split(/\r?\n/);
  if (!/^---[ \t]*$/.test(lines[0] ?? "")) return source;

  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      return lines.slice(i + 1).join("\n");
    }
  }
  return source;
}

function extractFootnotes(source: string): { markdown: string; footnotes: FootnoteDefinition[] } {
  const footnotes: FootnoteDefinition[] = [];
  const kept: string[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^[ \t]{0,3}\[\^([^\]\n]+)\]:[ \t]*(.*)$/);
    if (!match) {
      kept.push(lines[i]);
      continue;
    }

    const label = match[1].trim();
    const contentLines = [match[2]];
    while (i + 1 < lines.length) {
      const continuation = lines[i + 1].match(/^(?: {4}|\t)(.*)$/);
      if (!continuation) break;
      contentLines.push(continuation[1]);
      i++;
    }

    if (label.length > 0) {
      footnotes.push({
        label,
        id: markdownFootnoteId(label),
        content: contentLines.join("\n").trim(),
      });
    }
  }

  return { markdown: kept.join("\n"), footnotes };
}

function createRenderEnv(footnotes: FootnoteDefinition[], options: RenderOptions = {}): RuneRenderEnv {
  return {
    footnotesByLabel: new Map(footnotes.map((footnote) => [footnote.label, footnote])),
    footnoteOrder: [],
    footnoteNumbers: new Map(),
    footnoteRefCounts: new Map(),
    footnoteBackrefs: new Map(),
    idPrefix: options.idPrefix,
    headingCounts: new Map(),
    rewriteHref: options.rewriteHref,
  };
}

function scopedId(env: RuneRenderEnv, id: string): string {
  return `${env.idPrefix ?? ""}${id}`;
}

function appendFootnotes(html: string, env: RuneRenderEnv): string {
  const order = env.footnoteOrder ?? [];
  const footnotes = env.footnotesByLabel;
  if (!footnotes || order.length === 0) return html;

  const items = order
    .map((label) => {
      const footnote = footnotes.get(label);
      if (!footnote) return "";
      const body = md.renderInline(footnote.content, createRenderEnv([], {
        idPrefix: env.idPrefix,
        rewriteHref: env.rewriteHref,
      }));
      const backrefs = env.footnoteBackrefs?.get(label) ?? [`fnref-${scopedId(env, footnote.id)}`];
      const links = backrefs
        .map((refId, index) => `<a class="footnote-backref" href="#${refId}" aria-label="Back to reference ${index + 1}">&#8617;</a>`)
        .join(" ");
      return `<li id="fn-${scopedId(env, footnote.id)}">${body} ${links}</li>`;
    })
    .filter(Boolean)
    .join("\n");

  if (!items) return html;
  return `${html}<section class="footnotes" role="doc-endnotes">\n<ol>\n${items}\n</ol>\n</section>\n`;
}

export function markdownFootnoteId(label: string): string {
  const normalized = label.trim().replace(/\s+/g, "-");
  const safe = normalized.replace(/[^A-Za-z0-9_-]/g, (char) => `-${char.charCodeAt(0).toString(16)}-`);
  return safe || "note";
}

function calloutPlugin(markdownIt: MarkdownIt): void {
  markdownIt.core.ruler.after("block", "rune_callouts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      const open = tokens[i];
      const paragraph = tokens[i + 1];
      const inline = tokens[i + 2];
      if (open.type !== "blockquote_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;

      const match = inline.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)(?:\n|$)/i);
      if (!match) continue;

      const kind = match[1].toLowerCase();
      const title = match[2].trim() || titleCase(kind);
      open.attrJoin("class", `callout callout-${kind}`);
      open.attrSet("data-callout-title", title);
      inline.content = inline.content.slice(match[0].length);
    }
  });
}

function footnoteRefPlugin(markdownIt: MarkdownIt): void {
  markdownIt.inline.ruler.after("emphasis", "rune_footnote_ref", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5e) return false;

    const end = state.src.indexOf("]", state.pos + 2);
    if (end < 0) return false;

    const label = state.src.slice(state.pos + 2, end).trim();
    if (!label) return false;

    if (!silent) {
      const token = state.push("rune_footnote_ref", "sup", 0);
      token.content = label;
      token.meta = { label };
    }
    state.pos = end + 1;
    return true;
  });

  markdownIt.renderer.rules.rune_footnote_ref = (tokens, idx, _options, env) => {
    const label = String(tokens[idx].meta?.label ?? "");
    const renderEnv = env as RuneRenderEnv;
    const footnote = renderEnv.footnotesByLabel?.get(label);
    if (!footnote) return markdownIt.utils.escapeHtml(`[^${label}]`);

    let number = renderEnv.footnoteNumbers?.get(label);
    if (!number) {
      renderEnv.footnoteOrder?.push(label);
      number = renderEnv.footnoteOrder?.length ?? 1;
      renderEnv.footnoteNumbers?.set(label, number);
    }

    const refCount = (renderEnv.footnoteRefCounts?.get(label) ?? 0) + 1;
    renderEnv.footnoteRefCounts?.set(label, refCount);
    const scopedFootnoteId = scopedId(renderEnv, footnote.id);
    const refId = refCount === 1 ? `fnref-${scopedFootnoteId}` : `fnref-${scopedFootnoteId}-${refCount}`;
    const backrefs = renderEnv.footnoteBackrefs?.get(label) ?? [];
    backrefs.push(refId);
    renderEnv.footnoteBackrefs?.set(label, backrefs);

    return `<sup class="footnote-ref" id="${refId}"><a href="#fn-${scopedFootnoteId}">${number}</a></sup>`;
  };
}

function installProjectRenderRules(markdownIt: MarkdownIt): void {
  const defaultHeadingOpen = markdownIt.renderer.rules.heading_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultLinkOpen = markdownIt.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultImage = markdownIt.renderer.rules.image
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  markdownIt.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const renderEnv = env as RuneRenderEnv;
    if (renderEnv.idPrefix !== undefined) {
      const base = markdownHeadingSlug(tokens[idx + 1]?.content ?? "") || "section";
      const count = (renderEnv.headingCounts?.get(base) ?? 0) + 1;
      renderEnv.headingCounts?.set(base, count);
      const suffix = count === 1 ? "" : `-${count}`;
      tokens[idx].attrSet("id", scopedId(renderEnv, `${base}${suffix}`));
    }
    return defaultHeadingOpen(tokens, idx, options, env, self);
  };

  markdownIt.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    rewriteTokenAttribute(tokens[idx], "href", "link", env as RuneRenderEnv);
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  markdownIt.renderer.rules.image = (tokens, idx, options, env, self) => {
    rewriteTokenAttribute(tokens[idx], "src", "image", env as RuneRenderEnv);
    return defaultImage(tokens, idx, options, env, self);
  };
}

function rewriteTokenAttribute(
  token: { attrGet(name: string): string | null; attrSet(name: string, value: string): void },
  attribute: "href" | "src",
  kind: "link" | "image",
  env: RuneRenderEnv,
): void {
  const href = token.attrGet(attribute);
  if (href !== null && env.rewriteHref) token.attrSet(attribute, env.rewriteHref(href, kind));
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
