import { describe, it, expect } from "vitest";
import { mdRender } from "./render";

describe("export markdown render", () => {
  it("renders heading and bold", () => {
    const h = mdRender("# 제목\n\n**굵게**");
    expect(h).toContain("<h1>");
    expect(h).toContain("<strong>굵게</strong>");
  });
  it("renders a fenced code block", () => {
    expect(mdRender("```js\nconst x = 1;\n```")).toContain("<pre");
  });
  it("renders a GFM-ish table or list", () => {
    expect(mdRender("- a\n- b")).toContain("<ul>");
  });

  it("does not render YAML front matter as document content", () => {
    const html = mdRender("---\ntitle: Test\n---\n\n# Body");

    expect(html).toContain("<h1>Body</h1>");
    expect(html).not.toContain("title: Test");
    expect(html).not.toContain("<hr");
  });

  it("renders Markdown callouts without showing the callout marker", () => {
    const html = mdRender("> [!NOTE]\n> Keep this in mind.");

    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('data-callout-title="Note"');
    expect(html).toContain("Keep this in mind.");
    expect(html).not.toContain("[!NOTE]");
  });

  it("renders footnote references and definitions", () => {
    const html = mdRender("Text with a note[^first].\n\n[^first]: Foot note text.");

    expect(html).toContain('id="fnref-first"');
    expect(html).toContain('href="#fn-first"');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('id="fn-first"');
    expect(html).toContain("Foot note text.");
    expect(html).not.toContain("[^first]:");
  });

  it("keeps repeated footnote reference ids unique", () => {
    const html = mdRender("One[^same] and two[^same].\n\n[^same]: Shared note.");

    expect(html).toContain('id="fnref-same"');
    expect(html).toContain('id="fnref-same-2"');
    expect(html).toContain('href="#fnref-same"');
    expect(html).toContain('href="#fnref-same-2"');
  });
});
