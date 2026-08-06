import { describe, expect, it } from "vitest";
import type { CitationLibrary } from "../project/citations";
import { buildReferenceItems } from "./referencesPanel";

const library: CitationLibrary = {
  duplicates: [],
  entries: [
    { key: "kim2025", type: "article", sourcePath: "refs.bib", fields: { author: "Kim, Mina", title: "Study", year: "2025" } },
    { key: "lee2024", type: "book", sourcePath: "refs.bib", fields: { author: "Lee, Joon", title: "Book", year: "2024" } },
    { key: "unused2020", type: "book", sourcePath: "refs.bib", fields: { author: "Doe, Jane", title: "Unused", year: "2020" } },
  ],
};

describe("References View", () => {
  it("prioritizes active-document citations, then project citations, then uncited entries", () => {
    const items = buildReferenceItems(library, [
      { path: "a.md", markdown: "Active [@lee2024]. Missing [@gone]." },
      { path: "b.md", markdown: "Other [@kim2025]. Again [@lee2024]." },
    ], "a.md");

    expect(items.map((item) => `${item.status}:${item.key}`)).toEqual([
      "cited:lee2024",
      "missing:gone",
      "cited:kim2025",
      "uncited:unused2020",
    ]);
    expect(items[0].occurrences).toEqual([
      { path: "a.md", line: 1 },
      { path: "b.md", line: 1 },
    ]);
  });

  it("deduplicates repeated keys case-insensitively and sorts peers by key", () => {
    const items = buildReferenceItems(library, [
      { path: "b.md", markdown: "[@KIM2025] [@kim2025] [@missingB] [@missingA]" },
    ], null);

    expect(items.map((item) => item.key)).toEqual(["kim2025", "missingA", "missingB", "lee2024", "unused2020"]);
    expect(items[0].occurrences).toHaveLength(2);
  });
});
