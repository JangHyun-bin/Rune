import { describe, expect, it } from "vitest";
import { parseReadOnlyProperties, updateProperty } from "./propertiesPanel";

describe("read-only Properties", () => {
  it("reads supported scalar, inline-list, and block-list front matter", () => {
    const markdown = `---
title: "회의 기록"
tags: [project, "한국어"]
aliases:
  - Meeting notes
  - 회의록
lang: ko
unknown: keep me
---
# Body
`;

    expect(parseReadOnlyProperties(markdown)).toEqual({
      kind: "properties",
      entries: [
        { key: "title", values: ["회의 기록"] },
        { key: "tags", values: ["project", "한국어"] },
        { key: "aliases", values: ["Meeting notes", "회의록"] },
        { key: "lang", values: ["ko"] },
      ],
    });
  });

  it("leaves ordinary Markdown alone and reports unsafe front matter as invalid", () => {
    expect(parseReadOnlyProperties("# Plain document\nBody\n")).toEqual({ kind: "none" });
    expect(parseReadOnlyProperties("---\ntitle: Missing boundary\n")).toEqual({ kind: "invalid" });
    expect(parseReadOnlyProperties("---\ntitle: One\ntitle: Two\n---\n")).toEqual({ kind: "invalid" });
  });
});

describe("safe Properties editing", () => {
  it("changes one scalar while preserving comments, unknown keys, body, and CRLF", () => {
    const markdown = "---\r\n# keep this comment\r\ntitle: \"Old\"\r\nunknown: keep me\r\n---\r\n# Body\r\n";

    expect(updateProperty(markdown, "title", ["New: #1"])).toBe(
      "---\r\n# keep this comment\r\ntitle: \"New: #1\"\r\nunknown: keep me\r\n---\r\n# Body\r\n",
    );
  });

  it("replaces only a supported block list", () => {
    const markdown = `---
tags:
  - alpha
  - beta
aliases: [keep]
unknown:
  nested: value
---
Body
`;

    expect(updateProperty(markdown, "tags", ["project", "한국어"])).toBe(`---
tags:
  - "project"
  - "한국어"
aliases: [keep]
unknown:
  nested: value
---
Body
`);
  });

  it("adds missing fields without rewriting existing front matter or plain Markdown", () => {
    expect(updateProperty("---\nunknown: keep\n---\nBody\n", "lang", ["ko"])).toBe(
      "---\nunknown: keep\nlang: \"ko\"\n---\nBody\n",
    );
    expect(updateProperty("# Plain\nBody\n", "title", ["Plain"])).toBe(
      "---\ntitle: \"Plain\"\n---\n# Plain\nBody\n",
    );
  });

  it("reads back safely serialized quotes and Unicode without escape artifacts", () => {
    const updated = updateProperty("# Body\n", "title", ['He said "안녕"']);
    expect(updated).not.toBeNull();
    expect(parseReadOnlyProperties(updated!)).toEqual({
      kind: "properties",
      entries: [{ key: "title", values: ['He said "안녕"'] }],
    });
  });

  it("removes a cleared field and refuses unsafe front matter", () => {
    expect(updateProperty("---\ntitle: Old\nlang: ko\n---\nBody\n", "title", [])).toBe(
      "---\nlang: ko\n---\nBody\n",
    );
    expect(updateProperty("---\ntitle: One\ntitle: Two\n---\n", "title", ["Three"])).toBeNull();
    expect(updateProperty("---\ntitle: { nested: value }\n---\n", "title", ["Three"])).toBeNull();
    expect(updateProperty("---\ntitle: Old # keep\n---\n", "title", ["Three"])).toBeNull();
    expect(updateProperty("---\ntitle:\n  - one\n---\n", "title", ["Three"])).toBeNull();
  });
});
