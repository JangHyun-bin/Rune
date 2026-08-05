import { markdownLanguage } from "@codemirror/lang-markdown";
import { markdownFootnoteId } from "../export/render";
import { commands, type LinkTarget } from "../ipc/bindings";
import { markdownHeadingSlug, resolveMarkdownHref } from "../editor/markdownLinks";
import { parseHeadings } from "../editor/outline";
import { validateProject, type RuneProject } from "./project";

export type ProjectDiagnosticSeverity = "error" | "warning";
export type ProjectDiagnosticKind =
  | "duplicateFile"
  | "missingFile"
  | "unreadableFile"
  | "indexUnavailable"
  | "duplicateHeadingId"
  | "duplicateFootnoteId"
  | "brokenLink"
  | "unresolvedImage"
  | "unresolvedResource";

export interface ProjectDiagnostic {
  severity: ProjectDiagnosticSeverity;
  kind: ProjectDiagnosticKind;
  path: string;
  line: number | null;
  value: string;
}

export interface ProjectWorkspaceFile {
  path: string;
  absolutePath: string;
}

interface ProjectSource {
  path: string;
  absolutePath: string;
  markdown: string;
  headings: LinkTarget["headings"];
  targets: LinkTarget[] | null;
}

interface MarkdownNode {
  name: string;
  from: number;
  to: number;
  firstChild: MarkdownNode | null;
  nextSibling: MarkdownNode | null;
}

interface MarkdownDestination {
  kind: "link" | "image";
  href: string | null;
  label: string;
  line: number;
}

const kindOrder: Record<ProjectDiagnosticKind, number> = {
  duplicateFile: 0,
  missingFile: 1,
  unreadableFile: 2,
  indexUnavailable: 3,
  duplicateHeadingId: 4,
  unresolvedImage: 5,
  unresolvedResource: 6,
  brokenLink: 7,
  duplicateFootnoteId: 8,
};

export function hasFatalProjectDiagnostics(diagnostics: ProjectDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function lineAt(markdown: string, offset: number): number {
  return markdown.slice(0, offset).split("\n").length;
}

function normalizedLabel(markdown: string, from: number, to: number): string {
  return markdown.slice(from + 1, to - 1).trim().toLowerCase().replace(/\s+/g, " ");
}

function childText(markdown: string, node: MarkdownNode, name: string): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return markdown.slice(child.from, child.to);
  }
  return null;
}

function markdownDestinations(markdown: string): MarkdownDestination[] {
  const definitions = new Map<string, string>();
  const tree = markdownLanguage.parser.parse(markdown);
  let cursor = tree.cursor();
  do {
    if (cursor.name !== "LinkReference") continue;
    const label = childText(markdown, cursor.node, "LinkLabel");
    const url = childText(markdown, cursor.node, "URL");
    if (label && url) definitions.set(label.slice(1, -1).trim().toLowerCase().replace(/\s+/g, " "), unwrapUrl(url));
  } while (cursor.next());

  const destinations: MarkdownDestination[] = [];
  cursor = tree.cursor();
  do {
    const parent = cursor.node.parent;
    if (!parent || (parent.name !== "Link" && parent.name !== "Image")) continue;
    const kind = parent.name === "Image" ? "image" : "link";
    if (cursor.name === "URL") {
      destinations.push({ kind, href: unwrapUrl(markdown.slice(cursor.from, cursor.to)), label: "", line: lineAt(markdown, parent.from) });
    } else if (cursor.name === "LinkLabel" && childText(markdown, parent, "URL") === null) {
      const label = normalizedLabel(markdown, cursor.from, cursor.to);
      destinations.push({ kind, href: definitions.get(label) ?? null, label, line: lineAt(markdown, parent.from) });
    }
  } while (cursor.next());
  return destinations;
}

function unwrapUrl(value: string): string {
  return value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
}

function markdownDestinationHref(href: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(href) || href.startsWith("/") || href.startsWith("\\")) return null;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) || href.startsWith("//")) return null;
  const hash = href.indexOf("#");
  const beforeFragment = hash < 0 ? href : href.slice(0, hash);
  const query = beforeFragment.indexOf("?");
  const path = query < 0 ? beforeFragment : beforeFragment.slice(0, query);
  try {
    const decodedPath = decodeURIComponent(path).toLowerCase();
    return decodedPath === "" || decodedPath.endsWith(".md") || decodedPath.endsWith(".markdown")
      ? `${path}${hash < 0 ? "" : href.slice(hash)}`
      : null;
  } catch {
    return null;
  }
}

function localImagePath(sourcePath: string, href: string): string | null | false {
  const rawPath = href.split(/[?#]/, 1)[0];
  if (!rawPath) return null;
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(rawPath);
  if (!windowsAbsolute && (/^[A-Za-z][A-Za-z\d+.-]*:/.test(rawPath) || rawPath.startsWith("//"))) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (windowsAbsolute || decoded.startsWith("/") || decoded.startsWith("\\")) return false;
  const split = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
  if (split < 0) return false;
  const directory = sourcePath.slice(0, split);
  const separator = directory.includes("\\") ? "\\" : "/";
  const combined = `${directory}${separator}${decoded.replace(/[\\/]/g, separator)}`;
  const windows = /^[A-Za-z]:[\\/]/.test(combined);
  const prefix = windows ? combined.slice(0, 3) : "/";
  const segments: string[] = [];
  for (const segment of combined.replace(/\\/g, "/").slice(prefix.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return false;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return windows ? `${prefix.replace("/", "\\")}${segments.join("\\")}` : `/${segments.join("/")}`;
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  const windows = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableRoot = windows ? normalizedRoot.toLocaleLowerCase() : normalizedRoot;
  const comparablePath = windows ? normalizedPath.toLocaleLowerCase() : normalizedPath;
  return comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}/`);
}

function footnoteDefinitions(markdown: string): { id: string; line: number }[] {
  return markdown.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^[ \t]{0,3}\[\^([^\]\n]+)\]:/);
    return match ? [{ id: markdownFootnoteId(match[1].trim()), line: index + 1 }] : [];
  });
}

function duplicateIdDiagnostics(
  sources: ProjectSource[],
  kind: "duplicateHeadingId" | "duplicateFootnoteId",
  occurrences: (source: ProjectSource) => { id: string; line: number }[],
): ProjectDiagnostic[] {
  return sources.flatMap((source) => {
    const byId = new Map<string, { path: string; line: number }[]>();
    for (const occurrence of occurrences(source)) {
      const values = byId.get(occurrence.id) ?? [];
      values.push({ path: source.path, line: occurrence.line });
      byId.set(occurrence.id, values);
    }
    return [...byId].flatMap(([id, values]) => values.length < 2 ? [] : values.map((value) => ({
      severity: "warning" as const,
      kind,
      path: value.path,
      line: value.line,
      value: id,
    })));
  });
}

function sortDiagnostics(project: RuneProject, diagnostics: ProjectDiagnostic[]): ProjectDiagnostic[] {
  const order = new Map<string, number>();
  project.files.forEach((path, index) => { if (!order.has(path)) order.set(path, index); });
  return diagnostics.sort((left, right) => (order.get(left.path) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.path) ?? Number.MAX_SAFE_INTEGER)
    || (left.line ?? 0) - (right.line ?? 0)
    || kindOrder[left.kind] - kindOrder[right.kind]
    || (left.value < right.value ? -1 : left.value > right.value ? 1 : 0));
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export async function preflightProject(
  project: RuneProject,
  root: string,
  files: ProjectWorkspaceFile[],
): Promise<ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = validateProject(project, files.map((file) => file.path)).map((issue) => ({
    severity: "error",
    kind: issue.kind === "missing" ? "missingFile" : "duplicateFile",
    path: issue.path,
    line: null,
    value: issue.path,
  }));
  const byPath = new Map(files.map((file) => [file.path, file.absolutePath]));
  const sources: ProjectSource[] = [];
  const seen = new Set<string>();

  for (const path of project.files) {
    if (seen.has(path)) continue;
    seen.add(path);
    const absolutePath = byPath.get(path);
    if (!absolutePath) continue;
    const contents = await commands.readFile(absolutePath);
    if (contents.status === "error") {
      diagnostics.push({ severity: "error", kind: "unreadableFile", path, line: null, value: path });
      continue;
    }
    const indexed = await commands.workspaceIndexLinkTargets(root, absolutePath);
    if (indexed.status === "error") {
      diagnostics.push({ severity: "error", kind: "indexUnavailable", path, line: null, value: path });
    }
    sources.push({
      path,
      absolutePath,
      markdown: contents.data,
      headings: parseHeadings(contents.data),
      targets: indexed.status === "ok" ? indexed.data : null,
    });
  }

  const selectedHeadings = new Map(sources.map((source) => [pathKey(source.absolutePath), source.headings]));
  const selectedPaths = new Set(selectedHeadings.keys());
  for (const source of sources) {
    source.targets = source.targets?.map((target) => {
      const headings = selectedHeadings.get(pathKey(target.path));
      return headings ? { ...target, headings } : target;
    }) ?? null;
  }

  diagnostics.push(...duplicateIdDiagnostics(sources, "duplicateHeadingId", (source) => source.headings
    .map((heading) => ({ id: markdownHeadingSlug(heading.text), line: heading.line }))));
  diagnostics.push(...duplicateIdDiagnostics(sources, "duplicateFootnoteId", (source) => footnoteDefinitions(source.markdown)));

  for (const source of sources) {
    for (const destination of markdownDestinations(source.markdown)) {
      if (!destination.href) {
        diagnostics.push({ severity: "warning", kind: destination.kind === "image" ? "unresolvedImage" : "brokenLink", path: source.path, line: destination.line, value: destination.label });
        continue;
      }
      const documentHref = destination.kind === "link" ? markdownDestinationHref(destination.href) : null;
      if (documentHref !== null) {
        if (source.targets === null) continue;
        const resolved = resolveMarkdownHref(documentHref, source.targets, source.absolutePath, source.markdown);
        if (resolved.kind === "missing" || resolved.kind === "ambiguous" || resolved.kind === "invalid") {
          diagnostics.push({ severity: "warning", kind: "brokenLink", path: source.path, line: destination.line, value: destination.href });
        } else if (resolved.kind === "resolved" && !selectedPaths.has(pathKey(resolved.path))) {
          diagnostics.push({ severity: "warning", kind: "brokenLink", path: source.path, line: destination.line, value: destination.href });
        }
        continue;
      }
      const imagePath = localImagePath(source.absolutePath, destination.href);
      if (imagePath === null) continue;
      const exists = imagePath === false || !isWithinRoot(imagePath, root) ? null : await commands.pathExists(imagePath);
      if (!exists || exists.status === "error" || !exists.data) {
        diagnostics.push({
          severity: "warning",
          kind: destination.kind === "image" ? "unresolvedImage" : "unresolvedResource",
          path: source.path,
          line: destination.line,
          value: destination.href,
        });
      }
    }
  }

  const unique = new Map<string, ProjectDiagnostic>();
  for (const diagnostic of diagnostics) unique.set(`${diagnostic.kind}\0${diagnostic.path}\0${diagnostic.line}\0${diagnostic.value}`, diagnostic);
  return sortDiagnostics(project, [...unique.values()]);
}
