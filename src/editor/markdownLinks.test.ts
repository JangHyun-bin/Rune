import { describe, expect, it } from "vitest";
import type { LinkTarget } from "../ipc/bindings";
import { markdownHrefAt, markdownLinkCompletions, markdownLinkDiagnostics, resolveMarkdownHref } from "./markdownLinks";

const targets: LinkTarget[] = [
  {
    path: "C:\\work\\guide.md",
    relativePath: "guide.md",
    href: "../guide.md",
    name: "guide.md",
    title: "Guide",
    headings: [{ text: "Getting Started", level: 2, line: 8 }],
  },
];

describe("Markdown link resolution", () => {
  it("resolves a relative document link and heading from the workspace index", () => {
    expect(resolveMarkdownHref("../guide.md#getting-started", targets)).toEqual({
      kind: "resolved",
      path: "C:\\work\\guide.md",
      line: 8,
    });
  });

  it("normalizes equivalent dot segments in relative document links", () => {
    expect(resolveMarkdownHref("../notes/../guide.md", targets)).toEqual({
      kind: "resolved",
      path: "C:\\work\\guide.md",
      line: null,
    });
  });

  it("ignores web, mail, and in-page external links", () => {
    expect(resolveMarkdownHref("https://example.com/guide.md", targets)).toEqual({ kind: "ignored" });
    expect(resolveMarkdownHref("mailto:author@example.com", targets)).toEqual({ kind: "ignored" });
    expect(resolveMarkdownHref("//cdn.example.com/guide.md", targets)).toEqual({ kind: "ignored" });
  });

  it("resolves a fragment-only link against the active document", () => {
    expect(resolveMarkdownHref("#getting-started", targets, "C:\\work\\guide.md")).toEqual({
      kind: "resolved",
      path: "C:\\work\\guide.md",
      line: 8,
    });
  });

  it("rejects malformed and absolute local targets", () => {
    expect(resolveMarkdownHref("bad%ZZ.md", targets)).toEqual({ kind: "invalid" });
    expect(resolveMarkdownHref("C:\\outside.md", targets)).toEqual({ kind: "invalid" });
    expect(resolveMarkdownHref("/outside.md", targets)).toEqual({ kind: "invalid" });
  });

  it("distinguishes missing and ambiguous heading targets", () => {
    expect(resolveMarkdownHref("../guide.md#missing", targets)).toEqual({ kind: "missing" });
    const duplicated = [{
      ...targets[0],
      headings: [...targets[0].headings, { text: "Getting Started", level: 3, line: 20 }],
    }];
    expect(resolveMarkdownHref("../guide.md#getting-started", duplicated)).toEqual({ kind: "ambiguous" });
  });

  it("offers indexed files and their headings inside an inline Markdown link", () => {
    const fileText = "See [guide](";
    expect(markdownLinkCompletions(fileText, fileText.length, targets, null)).toMatchObject({
      from: fileText.length,
      options: [{ label: "../guide.md", apply: "../guide.md", detail: "Guide" }],
    });

    const headingText = "See [section](../guide.md#";
    expect(markdownLinkCompletions(headingText, headingText.length, targets, null)).toMatchObject({
      from: headingText.length,
      options: [{ label: "Getting Started", apply: "getting-started", detail: "H2 · L8" }],
    });
  });

  it("continues heading completion after a space-encoded Unicode path", () => {
    const unicode = [{ ...targets[0], href: "../안내 문서.md" }];
    const text = "[section](../안내%20문서.md#";
    expect(markdownLinkCompletions(text, text.length, unicode, null)?.options[0]).toMatchObject({
      label: "Getting Started",
      apply: "getting-started",
    });
  });

  it("diagnoses missing, ambiguous, and invalid document links from unsaved text", () => {
    const duplicated = [{
      ...targets[0],
      headings: [...targets[0].headings, { text: "Getting Started", level: 3, line: 20 }],
    }];
    const markdown = "[missing](missing.md) [duplicate](../guide.md#getting-started) [bad](bad%ZZ.md)";

    expect(markdownLinkDiagnostics(markdown, duplicated, null).map(({ kind, href }) => ({ kind, href }))).toEqual([
      { kind: "missing", href: "missing.md" },
      { kind: "ambiguous", href: "../guide.md#getting-started" },
      { kind: "invalid", href: "bad%ZZ.md" },
    ]);
  });

  it("finds the destination when the cursor is on link text or its target", () => {
    const markdown = "Open [the guide](../guide.md#getting-started) now";
    expect(markdownHrefAt(markdown, markdown.indexOf("the guide") + 2)).toBe("../guide.md#getting-started");
    expect(markdownHrefAt(markdown, markdown.indexOf("guide.md") + 2)).toBe("../guide.md#getting-started");
    expect(markdownHrefAt(markdown, 0)).toBeNull();
  });

  it("uses unsaved active headings without changing the persisted index snapshot", () => {
    const markdown = "# Brand New\nJump [here](#brand-new)\nAdd [another](#";
    expect(markdownLinkDiagnostics(markdown, targets, "C:\\work\\guide.md")).toEqual([]);
    expect(markdownLinkCompletions(markdown, markdown.length, targets, "C:\\work\\guide.md")?.options).toEqual([
      { label: "Brand New", apply: "brand-new", detail: "H1 · L1" },
    ]);
    expect(targets[0].headings).toEqual([{ text: "Getting Started", level: 2, line: 8 }]);
  });

  it("resolves active fragment links before the saved file reaches the index", () => {
    const markdown = "# Local Draft\n[go](#local-draft)\n[next](#";
    expect(markdownLinkDiagnostics(markdown, [], "C:\\work\\draft.md")).toEqual([]);
    expect(markdownLinkCompletions(markdown, markdown.length, [], "C:\\work\\draft.md")?.options[0]).toMatchObject({
      label: "Local Draft",
      apply: "local-draft",
    });
  });
});
