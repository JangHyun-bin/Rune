import { buildHtmlDocument } from "../export/exportDoc";
import { renderBody } from "../export/render";
import type { RuneProject } from "./project";

export interface ProjectDocument {
  path: string;
  markdown: string;
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

export async function buildProjectHtml(project: RuneProject, documents: ProjectDocument[]): Promise<string> {
  const byPath = new Map<string, string>();
  for (const document of documents) {
    if (byPath.has(document.path)) throw new Error(`Duplicate project document: ${document.path}`);
    byPath.set(document.path, document.markdown);
  }

  const sections = await Promise.all(project.files.map(async (path) => {
    const markdown = byPath.get(path);
    if (markdown === undefined) throw new Error(`Missing project document: ${path}`);
    const body = await renderBody(markdown);
    return `<section class="project-document" data-project-file="${escapeAttribute(path)}">${body}</section>`;
  }));

  // ponytail: cross-document anchor collisions stay visible until H4 diagnostics can report them safely.
  return buildHtmlDocument(project.title, sections.join("\n"));
}
