import { describe, expect, it } from "vitest";
import { parseReadOnlyProperties } from "./propertiesPanel";

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
