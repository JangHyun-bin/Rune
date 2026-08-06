import { describe, expect, it } from "vitest";
import type { CitationEntry } from "../project/citations";
import { citationCompletions, citationDiagnostics } from "./citations";

const entries: CitationEntry[] = [
  { key: "kim2025", type: "article", sourcePath: "refs.bib", fields: { author: "Kim, Mina", title: "Rune Study", year: "2025" } },
  { key: "lee2024", type: "book", sourcePath: "refs.bib", fields: { author: "Lee, Joon", title: "Other Work", year: "2024" } },
  { key: "rune2023", type: "book", sourcePath: "refs.bib", fields: { author: "Doe, Jane", title: "Kimchi Notes", year: "2023" } },
];

describe("citation editor UX", () => {
  it("completes keys after @ only inside an open Pandoc citation group", () => {
    const markdown = "Claim [see @ki";
    expect(citationCompletions(markdown, markdown.length, entries)).toEqual({
      from: 12,
      options: [
        { label: "kim2025", detail: "Kim, 2025 · Rune Study" },
        { label: "rune2023", detail: "Doe, 2023 · Kimchi Notes" },
      ],
    });
    expect(citationCompletions("mail@ki", 7, entries)).toBeNull();
    expect(citationCompletions("Closed [@ki]", 11, entries)).toBeNull();
  });

  it("orders an empty query by citation key and supports a second group item", () => {
    const markdown = "Claim [@kim2025; @";
    expect(citationCompletions(markdown, markdown.length, entries)?.options.map((item) => item.label))
      .toEqual(["kim2025", "lee2024", "rune2023"]);
  });

  it("diagnoses only missing citation keys", () => {
    expect(citationDiagnostics("Known [@kim2025]. Missing [@gone].", entries)).toEqual([
      { from: 28, to: 32, key: "gone" },
    ]);
  });
});
