import { describe, expect, it } from "vitest";
import { buildOutlineTree, filterOutlineTree, parseHeadings } from "./outline";

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

describe("buildOutlineTree", () => {
  it("nests headings under the nearest preceding lower-level heading", () => {
    expect(buildOutlineTree([
      { level: 1, line: 1, text: "One" },
      { level: 3, line: 2, text: "Deep" },
      { level: 2, line: 3, text: "Two" },
      { level: 1, line: 4, text: "Next" },
    ])).toEqual([
      {
        level: 1,
        line: 1,
        text: "One",
        children: [
          { level: 3, line: 2, text: "Deep", children: [] },
          { level: 2, line: 3, text: "Two", children: [] },
        ],
      },
      { level: 1, line: 4, text: "Next", children: [] },
    ]);
  });
});

describe("filterOutlineTree", () => {
  it("keeps matching headings and their ancestor path", () => {
    const tree = buildOutlineTree([
      { level: 1, line: 1, text: "Chapter" },
      { level: 2, line: 2, text: "Background" },
      { level: 3, line: 3, text: "Network Model" },
      { level: 2, line: 4, text: "Results" },
    ]);

    expect(filterOutlineTree(tree, "network")).toEqual([
      {
        level: 1,
        line: 1,
        text: "Chapter",
        children: [{
          level: 2,
          line: 2,
          text: "Background",
          children: [{ level: 3, line: 3, text: "Network Model", children: [] }],
        }],
      },
    ]);
  });
});
