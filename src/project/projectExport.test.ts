import { describe, expect, it } from "vitest";
import { createProject } from "./project";
import { buildProjectHtml } from "./projectExport";

describe("project HTML assembly", () => {
  it("renders selected documents in manifest order without front matter", async () => {
    const project = createProject("Research & Notes", ["intro.md", "chapters/two.md"]);
    const html = await buildProjectHtml(project, [
      { path: "chapters/two.md", markdown: "---\ntitle: Hidden Two\n---\n# Two" },
      { path: "intro.md", markdown: "---\ntitle: Hidden Intro\n---\n# Intro" },
    ]);

    expect(html).toContain("<title>Research &amp; Notes</title>");
    expect(html).toContain('<section class="project-document" data-project-file="intro.md">');
    expect(html).toContain('<section class="project-document" data-project-file="chapters/two.md">');
    expect(html.indexOf("<h1>Intro</h1>")).toBeLessThan(html.indexOf("<h1>Two</h1>"));
    expect(html).not.toContain("Hidden Intro");
    expect(html).not.toContain("Hidden Two");
  });

  it("refuses missing or duplicate document inputs", async () => {
    const project = createProject("Book", ["one.md", "two.md"]);

    await expect(buildProjectHtml(project, [{ path: "one.md", markdown: "# One" }])).rejects.toThrow("two.md");
    await expect(buildProjectHtml(project, [
      { path: "one.md", markdown: "# One" },
      { path: "one.md", markdown: "# Duplicate" },
      { path: "two.md", markdown: "# Two" },
    ])).rejects.toThrow("one.md");
  });
});
