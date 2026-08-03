import type { LinkTarget } from "../ipc/bindings";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { parseHeadings } from "./outline";

export type MarkdownLinkResolution =
  | { kind: "resolved"; path: string; line: number | null }
  | { kind: "missing" | "ambiguous" | "invalid" | "ignored" };

export interface MarkdownLinkCompletion {
  label: string;
  apply: string;
  detail: string;
}

export interface MarkdownLinkCompletionResult {
  from: number;
  options: MarkdownLinkCompletion[];
}

export interface MarkdownLinkDiagnostic {
  from: number;
  to: number;
  href: string;
  kind: "missing" | "ambiguous" | "invalid";
}

export interface MarkdownLinkExtensionOptions {
  getTargets: () => LinkTarget[];
  getCurrentPath: () => string | null;
  diagnosticMessage: (kind: MarkdownLinkDiagnostic["kind"], href: string) => string;
  openLink: (path: string, line: number | null) => void;
}

export function markdownHeadingSlug(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function activeTarget(markdown: string, path: string): LinkTarget {
  const headings = parseHeadings(markdown);
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return {
    path,
    relativePath: name,
    href: name,
    name,
    title: headings.find((heading) => heading.level === 1)?.text ?? name.replace(/\.(md|markdown)$/i, ""),
    headings,
  };
}

function normalizeRelativePath(path: string): string {
  const normalized: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && normalized.length && normalized[normalized.length - 1] !== "..") {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

export function resolveMarkdownHref(
  href: string,
  targets: LinkTarget[],
  currentPath: string | null = null,
  currentMarkdown: string | null = null,
): MarkdownLinkResolution {
  if (/^[a-z]:[\\/]/i.test(href) || (href.startsWith("/") && !href.startsWith("//"))) {
    return { kind: "invalid" };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "ignored" };
  const [rawPath, rawFragment] = href.split("#", 2);
  let path: string;
  let fragment: string;
  try {
    path = decodeURIComponent(rawPath);
    fragment = decodeURIComponent(rawFragment ?? "");
  } catch {
    return { kind: "invalid" };
  }
  const normalizedPath = normalizeRelativePath(path);
  let matches = targets.filter((target) => path
    ? normalizeRelativePath(target.href) === normalizedPath
    : target.path === currentPath);
  if (!path && matches.length === 0 && currentPath && currentMarkdown !== null) {
    matches = [activeTarget(currentMarkdown, currentPath)];
  }
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous" };
  const target = matches[0];
  if (!fragment) return { kind: "resolved", path: target.path, line: null };
  const sourceHeadings = currentMarkdown !== null && target.path === currentPath
    ? parseHeadings(currentMarkdown)
    : target.headings;
  const headings = sourceHeadings.filter(
    (heading) => markdownHeadingSlug(heading.text) === fragment.toLocaleLowerCase(),
  );
  if (headings.length === 0) return { kind: "missing" };
  if (headings.length > 1) return { kind: "ambiguous" };
  return { kind: "resolved", path: target.path, line: headings[0].line };
}

export function markdownLinkCompletions(
  text: string,
  position: number,
  targets: LinkTarget[],
  currentPath: string | null,
): MarkdownLinkCompletionResult | null {
  const before = text.slice(0, position);
  const match = /\]\(<?([^\s)>]*)$/.exec(before);
  if (!match) return null;
  const value = match[1];
  const hash = value.indexOf("#");
  if (hash < 0) {
    return {
      from: position - value.length,
      options: targets
        .filter((target) => target.path !== currentPath)
        .map((target) => ({
          label: target.href,
          apply: target.href.replace(/ /g, "%20"),
          detail: target.title,
        })),
    };
  }
  let path: string;
  try {
    path = decodeURIComponent(value.slice(0, hash));
  } catch {
    return { from: position, options: [] };
  }
  const normalizedPath = normalizeRelativePath(path);
  const indexedTarget = targets.find((candidate) => path
    ? normalizeRelativePath(candidate.href) === normalizedPath
    : candidate.path === currentPath);
  const target = indexedTarget?.path === currentPath
    ? activeTarget(text, currentPath)
    : indexedTarget ?? (!path && currentPath ? activeTarget(text, currentPath) : undefined);
  if (!target) return { from: position, options: [] };
  return {
    from: position - (value.length - hash - 1),
    options: target.headings.map((heading) => ({
      label: heading.text,
      apply: markdownHeadingSlug(heading.text),
      detail: `H${heading.level} · L${heading.line}`,
    })),
  };
}

function isDocumentHref(href: string): boolean {
  const path = href.split("#", 1)[0].replace(/^<|>$/g, "").toLocaleLowerCase();
  return path === "" || path.endsWith(".md") || path.endsWith(".markdown");
}

export function markdownLinkDiagnostics(
  markdown: string,
  targets: LinkTarget[],
  currentPath: string | null,
): MarkdownLinkDiagnostic[] {
  const diagnostics: MarkdownLinkDiagnostic[] = [];
  const cursor = markdownLanguage.parser.parse(markdown).cursor();
  do {
    if (cursor.name !== "URL" || cursor.node.parent?.name !== "Link") continue;
    const raw = markdown.slice(cursor.from, cursor.to);
    const href = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
    if (!isDocumentHref(href)) continue;
    const resolution = resolveMarkdownHref(href, targets, currentPath, markdown);
    if (resolution.kind === "missing" || resolution.kind === "ambiguous" || resolution.kind === "invalid") {
      diagnostics.push({ from: cursor.from, to: cursor.to, href, kind: resolution.kind });
    }
  } while (cursor.next());
  return diagnostics;
}

export function markdownHrefAt(markdown: string, position: number): string | null {
  const cursor = markdownLanguage.parser.parse(markdown).cursor();
  do {
    const parent = cursor.node.parent;
    if (cursor.name !== "URL" || parent?.name !== "Link" || position < parent.from || position > parent.to) {
      continue;
    }
    const raw = markdown.slice(cursor.from, cursor.to);
    return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  } while (cursor.next());
  return null;
}

export function markdownLinkExtensions(options: MarkdownLinkExtensionOptions): Extension[] {
  const openAt = (view: EditorView, position: number): boolean => {
    const href = markdownHrefAt(view.state.doc.toString(), position);
    if (!href) return false;
    const resolution = resolveMarkdownHref(
      href,
      options.getTargets(),
      options.getCurrentPath(),
      view.state.doc.toString(),
    );
    if (resolution.kind !== "resolved") return false;
    options.openLink(resolution.path, resolution.line);
    return true;
  };
  const complete = (context: CompletionContext) => {
    const result = markdownLinkCompletions(
      context.state.doc.toString(),
      context.pos,
      options.getTargets(),
      options.getCurrentPath(),
    );
    if (!result) return null;
    return {
      from: result.from,
      options: result.options.map((item) => ({ ...item, type: item.detail.startsWith("H") ? "text" : "file" })),
    };
  };
  return [
    autocompletion({ override: [complete] }),
    keymap.of([{ key: "Mod-Enter", run: (view) => openAt(view, view.state.selection.main.head) }]),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null || !openAt(view, position)) return false;
        event.preventDefault();
        return true;
      },
    }),
    linter((view): Diagnostic[] => markdownLinkDiagnostics(
      view.state.doc.toString(),
      options.getTargets(),
      options.getCurrentPath(),
    ).map((diagnostic) => ({
      from: diagnostic.from,
      to: diagnostic.to,
      severity: diagnostic.kind === "invalid" ? "error" : "warning",
      message: options.diagnosticMessage(diagnostic.kind, diagnostic.href),
    }))),
  ];
}

export function refreshMarkdownLinkDiagnostics(view: EditorView): void {
  forceLinting(view);
}
