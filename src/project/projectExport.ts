import { buildHtmlDocument, type HtmlDocumentOptions } from "../export/exportDoc";
import { renderBody } from "../export/render";
import { markdownHeadingSlug } from "../editor/markdownLinks";
import { parseHeadings } from "../editor/outline";
import type { RuneProject } from "./project";

export interface ProjectDocument {
  path: string;
  absolutePath?: string;
  markdown: string;
}

export interface ProjectAsset {
  token: string;
  sourcePath: string;
  relativePath: string;
}

export interface ProjectPublication {
  html: string;
  assets: ProjectAsset[];
}

export interface ProjectExportOptions extends HtmlDocumentOptions {
  tableOfContents?: boolean;
  tableOfContentsDepth?: number;
  workspaceRoot?: string;
}

interface DocumentContext {
  document: ProjectDocument;
  index: number;
  sectionId: string;
  idPrefix: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] as string);
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] as string);
}

function pathKey(path: string, windows: boolean): string {
  const normalized = path.replace(/\\/g, "/");
  return windows ? normalized.toLocaleLowerCase() : normalized;
}

function normalizeRelativePath(sourcePath: string, targetPath: string): string | null {
  const parts = sourcePath.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const part of targetPath.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function hrefParts(href: string): { path: string; fragment: string } | null {
  if (/^[A-Za-z]:[\\/]/.test(href) || href.startsWith("/") || href.startsWith("\\")) return null;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) || href.startsWith("//")) return null;
  const hash = href.indexOf("#");
  const beforeFragment = hash < 0 ? href : href.slice(0, hash);
  const query = beforeFragment.indexOf("?");
  try {
    return {
      path: decodeURIComponent(query < 0 ? beforeFragment : beforeFragment.slice(0, query)),
      fragment: decodeURIComponent(hash < 0 ? "" : href.slice(hash + 1)),
    };
  } catch {
    return null;
  }
}

function isMarkdownPath(path: string): boolean {
  return path === "" || /\.(md|markdown)$/i.test(path);
}

function safeAssetName(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "asset";
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "") || "asset";
}

function absoluteSibling(sourcePath: string, relativePath: string): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(sourcePath);
  const separator = windows ? "\\" : "/";
  const normalized = sourcePath.replace(/\\/g, "/");
  const prefix = windows ? normalized.slice(0, 3) : "/";
  const base = normalized.slice(prefix.length).split("/").slice(0, -1);
  for (const part of relativePath.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (base.length === 0) return null;
      base.pop();
    } else {
      base.push(part);
    }
  }
  return windows ? `${prefix.replace("/", "\\")}${base.join(separator)}` : `${prefix}${base.join(separator)}`;
}

function isWithinRoot(path: string, root: string | undefined, windows: boolean): boolean {
  if (!root) return true;
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  const comparableRoot = windows ? normalizedRoot.toLocaleLowerCase() : normalizedRoot;
  const comparablePath = windows ? normalizedPath.toLocaleLowerCase() : normalizedPath;
  return comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}/`);
}

function encodedRelativeUrl(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function outputAssetRoot(outputPath: string): string {
  const name = outputPath.replace(/\\/g, "/").split("/").pop() ?? "publication.html";
  const stem = name.replace(/\.[^.]*$/, "") || "publication";
  return `${stem}.assets`;
}

function headingLinks(context: DocumentContext, depth: number): { level: number; text: string; id: string }[] {
  const counts = new Map<string, number>();
  return parseHeadings(context.document.markdown).flatMap((heading) => {
    const base = markdownHeadingSlug(heading.text) || "section";
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    if (heading.level > depth) return [];
    return [{
      level: heading.level,
      text: heading.text,
      id: `${context.idPrefix}${base}${count === 1 ? "" : `-${count}`}`,
    }];
  });
}

function buildTableOfContents(contexts: DocumentContext[], depth: number): string {
  const items = contexts.flatMap((context) => {
    const headings = headingLinks(context, depth);
    if (headings.length === 0) {
      return [`<li class="toc-entry toc-level-1"><a href="#${context.sectionId}">${escapeHtml(context.document.path)}</a></li>`];
    }
    return headings.map((heading) => `<li class="toc-entry toc-level-${heading.level}"><a href="#${escapeAttribute(heading.id)}">${escapeHtml(heading.text)}</a></li>`);
  });
  return `<nav class="project-toc" aria-label="Table of contents"><ol>${items.join("\n")}</ol></nav>`;
}

export async function buildProjectPublication(
  project: RuneProject,
  documents: ProjectDocument[],
  options: ProjectExportOptions = {},
): Promise<ProjectPublication> {
  const byPath = new Map<string, ProjectDocument>();
  for (const document of documents) {
    if (byPath.has(document.path)) throw new Error(`Duplicate project document: ${document.path}`);
    byPath.set(document.path, document);
  }

  const contexts = project.files.map((path, index): DocumentContext => {
    const document = byPath.get(path);
    if (!document) throw new Error(`Missing project document: ${path}`);
    return { document, index, sectionId: `doc-${index + 1}`, idPrefix: `doc-${index + 1}-` };
  });
  const exactContexts = new Map(contexts.map((context) => [pathKey(context.document.path, false), context]));
  const windowsContexts = new Map(contexts.map((context) => [pathKey(context.document.path, true), context]));
  const assets: ProjectAsset[] = [];
  const assetBySource = new Map<string, ProjectAsset>();

  const sections = await Promise.all(contexts.map(async (context) => {
    const windows = /^[A-Za-z]:[\\/]/.test(context.document.absolutePath ?? "");
    const rewriteHref = (href: string, kind: "link" | "image"): string => {
      const parts = hrefParts(href);
      if (!parts) return href;
      if (kind === "link") {
        if (!isMarkdownPath(parts.path)) return href;
        const targetPath = parts.path ? normalizeRelativePath(context.document.path, parts.path) : context.document.path;
        if (!targetPath) return href;
        const target = (windows ? windowsContexts : exactContexts).get(pathKey(targetPath, windows));
        if (!target) return href;
        if (!parts.fragment) return `#${target.sectionId}`;
        return `#${target.idPrefix}${markdownHeadingSlug(parts.fragment) || "section"}`;
      }

      if (!parts.path || !context.document.absolutePath) return href;
      const sourcePath = absoluteSibling(context.document.absolutePath, parts.path);
      if (!sourcePath || !isWithinRoot(sourcePath, options.workspaceRoot, windows)) return href;
      const key = pathKey(sourcePath, windows);
      let asset = assetBySource.get(key);
      if (!asset) {
        asset = {
          token: `__RUNE_PROJECT_ASSET_${String(assets.length + 1).padStart(4, "0")}__`,
          sourcePath,
          relativePath: `doc-${context.index + 1}/asset-${assets.length + 1}-${safeAssetName(parts.path)}`,
        };
        assetBySource.set(key, asset);
        assets.push(asset);
      }
      return asset.token;
    };
    const body = await renderBody(context.document.markdown, { idPrefix: context.idPrefix, rewriteHref });
    return `<section id="${context.sectionId}" class="project-document" data-project-file="${escapeAttribute(context.document.path)}">${body}</section>`;
  }));

  const tocDepth = Math.max(1, Math.min(6, Math.trunc(options.tableOfContentsDepth ?? 3)));
  const toc = options.tableOfContents ? buildTableOfContents(contexts, tocDepth) : "";
  const title = `<header class="project-title"><h1>${escapeHtml(project.title)}</h1></header>`;
  return {
    html: buildHtmlDocument(project.title, `${title}${toc}${sections.join("\n")}`, options),
    assets,
  };
}

export function materializeProjectHtml(
  publication: ProjectPublication,
  assetUrl: (asset: ProjectAsset) => string,
): string {
  let html = publication.html;
  for (const asset of publication.assets) {
    html = html.split(`src="${asset.token}"`).join(`src="${escapeAttribute(assetUrl(asset))}"`);
  }
  return html;
}

export function materializeProjectHtmlForOutput(publication: ProjectPublication, outputPath: string): string {
  const root = encodeURIComponent(outputAssetRoot(outputPath));
  return materializeProjectHtml(publication, (asset) => `${root}/${encodedRelativeUrl(asset.relativePath)}`);
}

export async function buildProjectHtml(project: RuneProject, documents: ProjectDocument[]): Promise<string> {
  const publication = await buildProjectPublication(project, documents);
  return materializeProjectHtml(publication, (asset) => `project.assets/${encodedRelativeUrl(asset.relativePath)}`);
}
