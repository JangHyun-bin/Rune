import { describe, expect, it } from "vitest";
import { parseHeadings } from "./outline";

describe("parseHeadings", () => {
  it("parses ATX headings with levels and line numbers", () => {
    expect(parseHeadings("# One\ntext\n### Three ###")).toEqual([
      { level: 1, line: 1, text: "One" },
      { level: 3, line: 3, text: "Three" },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    expect(parseHeadings("```md\n# Nope\n```\n## Yes")).toEqual([
      { level: 2, line: 4, text: "Yes" },
    ]);
  });
});
