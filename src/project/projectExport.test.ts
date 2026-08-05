import { describe, expect, it, vi } from "vitest";
import { createProject } from "./project";

const renderDelays = vi.hoisted(() => new Map<string, number>());

vi.mock("../export/render", async (importOriginal) => {
  const original = await importOriginal<typeof import("../export/render")>();
  return {
    ...original,
    renderBody: async (markdown: string, options?: Parameters<typeof original.renderBody>[1]) => {
      const delay = renderDelays.get(markdown) ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return original.renderBody(markdown, options);
    },
  };
});

import {
  buildProjectHtml,
  buildProjectPublication,
  materializeProjectHtml,
  materializeProjectHtmlForOutput,
} from "./projectExport";

describe("project HTML assembly", () => {
  it("renders selected documents in manifest order without front matter", async () => {
    const project = createProject("Research & Notes", ["intro.md", "chapters/two.md"]);
    const html = await buildProjectHtml(project, [
      { path: "chapters/two.md", markdown: "---\ntitle: Hidden Two\n---\n# Two" },
      { path: "intro.md", markdown: "---\ntitle: Hidden Intro\n---\n# Intro" },
    ]);

    expect(html).toContain("<title>Research &amp; Notes</title>");
    expect(html).toContain('<section id="doc-1" class="project-document" data-project-file="intro.md">');
    expect(html).toContain('<section id="doc-2" class="project-document" data-project-file="chapters/two.md">');
    expect(html.indexOf('<h1 id="doc-1-intro">Intro</h1>')).toBeLessThan(html.indexOf('<h1 id="doc-2-two">Two</h1>'));
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

  it("namespaces headings and footnotes and rewrites same-document and cross-document links", async () => {
    const project = createProject("Book", ["intro.md", "chapters/한글 문서.md"]);
    const publication = await buildProjectPublication(project, [
      {
        path: "intro.md",
        absolutePath: "C:\\book\\intro.md",
        markdown: "# Shared\n[Same](#shared) [Other](chapters/%ED%95%9C%EA%B8%80%20%EB%AC%B8%EC%84%9C.md#shared)\nText[^note].\n\n[^note]: Intro note",
      },
      {
        path: "chapters/한글 문서.md",
        absolutePath: "C:\\book\\chapters\\한글 문서.md",
        markdown: "# Shared\n[Back](..\\intro.md#shared)\nText[^note].\n\n[^note]: Other note",
      },
    ]);

    expect(publication.html).toContain('<h1 id="doc-1-shared">Shared</h1>');
    expect(publication.html).toContain('<h1 id="doc-2-shared">Shared</h1>');
    expect(publication.html).toContain('href="#doc-1-shared"');
    expect(publication.html).toContain('href="#doc-2-shared"');
    expect(publication.html).toContain('id="fn-doc-1-note"');
    expect(publication.html).toContain('id="fn-doc-2-note"');
    expect(publication.html).toContain('href="#fn-doc-1-note"');
    expect(publication.html).toContain('href="#fn-doc-2-note"');
  });

  it("assembles the same logical project deterministically across paths and render timing", async () => {
    const project = createProject("Book", ["chapters/intro.md", "chapters/two.md"]);
    const intro = "# Shared\n[Other](two.md#shared)\nText[^note].\n\n[^note]: Intro note\n\n![Intro](../assets/intro.png)";
    const two = "# Shared\n[Back](intro.md#shared)\nText[^note].\n\n[^note]: Two note\n\n![Two](../assets/two.png)";
    const windows = [
      { path: "chapters/two.md", absolutePath: "C:\\book\\chapters\\two.md", markdown: two },
      { path: "chapters/intro.md", absolutePath: "C:\\book\\chapters\\intro.md", markdown: intro },
    ];
    const posix = [
      { path: "chapters/two.md", absolutePath: "/book/chapters/two.md", markdown: two },
      { path: "chapters/intro.md", absolutePath: "/book/chapters/intro.md", markdown: intro },
    ];
    const sourceMarkdown = windows.map((document) => document.markdown);

    renderDelays.set(intro, 10);
    const windowsPublication = await buildProjectPublication(project, windows, { workspaceRoot: "C:\\book" });
    renderDelays.clear();
    renderDelays.set(two, 10);
    const posixPublication = await buildProjectPublication(project, posix, { workspaceRoot: "/book" });
    renderDelays.clear();

    expect(windows.map((document) => document.markdown)).toEqual(sourceMarkdown);
    expect(windowsPublication.html).toBe(posixPublication.html);
    expect(windowsPublication.html).toContain('<h1 id="doc-1-shared">Shared</h1>');
    expect(windowsPublication.html).toContain('<h1 id="doc-2-shared">Shared</h1>');
    expect(windowsPublication.html).toContain('href="#doc-1-shared"');
    expect(windowsPublication.html).toContain('href="#doc-2-shared"');
    expect(windowsPublication.html).toContain('id="fn-doc-1-note"');
    expect(windowsPublication.html).toContain('id="fn-doc-2-note"');
    expect(windowsPublication.assets.map(({ token, relativePath }) => ({ token, relativePath }))).toEqual([
      { token: "__RUNE_PROJECT_ASSET_0001__", relativePath: "doc-1/asset-1-intro.png" },
      { token: "__RUNE_PROJECT_ASSET_0002__", relativePath: "doc-2/asset-2-two.png" },
    ]);
    expect(posixPublication.assets.map(({ token, relativePath }) => ({ token, relativePath })))
      .toEqual(windowsPublication.assets.map(({ token, relativePath }) => ({ token, relativePath })));
  });

  it("collects relative images with stable collision-free paths and preserves remote and data URLs", async () => {
    const project = createProject("Book", ["chapters/one.md"]);
    const publication = await buildProjectPublication(project, [{
      path: "chapters/one.md",
      absolutePath: "C:\\book\\chapters\\one.md",
      markdown: "![One](../assets/My%20Cover.png) ![Two](../other/My%20Cover.png) ![Remote](https://example.com/a.png) ![Data](data:image/png;base64,abc)",
    }]);

    expect(publication.assets).toEqual([
      {
        token: "__RUNE_PROJECT_ASSET_0001__",
        sourcePath: "C:\\book\\assets\\My Cover.png",
        relativePath: "doc-1/asset-1-My Cover.png",
      },
      {
        token: "__RUNE_PROJECT_ASSET_0002__",
        sourcePath: "C:\\book\\other\\My Cover.png",
        relativePath: "doc-1/asset-2-My Cover.png",
      },
    ]);
    const saved = materializeProjectHtmlForOutput(publication, "C:\\exports\\My Book.html");
    expect(saved).toContain("My%20Book.assets/doc-1/asset-1-My%20Cover.png");
    expect(saved).toContain("My%20Book.assets/doc-1/asset-2-My%20Cover.png");
    expect(saved).toContain("https://example.com/a.png");
    expect(saved).toContain("data:image/png;base64,abc");
    expect(saved).not.toContain("__RUNE_PROJECT_ASSET_");
  });

  it("does not collect images outside the configured workspace root", async () => {
    const publication = await buildProjectPublication(createProject("Book", ["one.md"]), [{
      path: "one.md",
      absolutePath: "C:\\book\\one.md",
      markdown: "![Secret](../secret.png)",
    }], { workspaceRoot: "C:\\book" });

    expect(publication.assets).toEqual([]);
    expect(publication.html).toContain('src="../secret.png"');
  });

  it("builds deterministic output with an optional heading TOC and print settings", async () => {
    const project = createProject("Book", ["one.md"]);
    const documents = [{ path: "one.md", absolutePath: "/book/one.md", markdown: "# One\n## Detail" }];
    const options = {
      tableOfContents: true,
      tableOfContentsDepth: 1,
      pageSize: "Letter" as const,
      margins: { top: 10, right: 11, bottom: 12, left: 13 },
    };

    const first = await buildProjectPublication(project, documents, options);
    const second = await buildProjectPublication(project, documents, options);

    expect(first).toEqual(second);
    expect(first.html).toContain('<nav class="project-toc"');
    expect(first.html).toContain('href="#doc-1-one"');
    expect(first.html).not.toContain('href="#doc-1-detail"');
    expect(first.html).toContain("@page{size:Letter;margin:10mm 11mm 12mm 13mm}");
    expect(materializeProjectHtml(first, () => "unused")).toBe(first.html);
  });

  it("replaces only generated image attributes when source text contains an asset token", async () => {
    const publication = await buildProjectPublication(createProject("Book", ["one.md"]), [{
      path: "one.md",
      absolutePath: "/book/one.md",
      markdown: "Token: `__RUNE_PROJECT_ASSET_0001__`\n\n![Image](image.png)",
    }]);

    const html = materializeProjectHtml(publication, () => "Book.assets/image.png");

    expect(html).toContain("<code>__RUNE_PROJECT_ASSET_0001__</code>");
    expect(html).toContain('src="Book.assets/image.png"');
  });
});
