import { describe, expect, it } from "vitest";
import { citationLabel, findCitationGroups, parseBibTeX, referenceText } from "./citations";

describe("project citations", () => {
  it("parses common BibTeX values without flattening nested braces or Unicode", () => {
    const parsed = parseBibTeX(`
      @article{kim2025,
        author = {Kim, Mina and Lee, Joon},
        title = {A {Rune} 연구},
        year = "2025"
      }
      @book{doe2020, author="Jane Doe", title={Plain Book}, year={2020}}
    `, "references/main.bib");

    expect(parsed.duplicates).toEqual([]);
    expect(parsed.entries.map((entry) => entry.key)).toEqual(["kim2025", "doe2020"]);
    expect(parsed.entries[0]).toMatchObject({
      type: "article",
      sourcePath: "references/main.bib",
      fields: { author: "Kim, Mina and Lee, Joon", title: "A {Rune} 연구", year: "2025" },
    });
    expect(citationLabel(parsed.entries[0])).toBe("Kim & Lee, 2025");
    expect(referenceText(parsed.entries[1])).toBe("Jane Doe (2020). Plain Book.");
  });

  it("keeps the first duplicate key and reports later definitions case-insensitively", () => {
    const parsed = parseBibTeX("@book{Same, title={First}}\n@article{same, title={Second}}", "refs.bib");

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].fields.title).toBe("First");
    expect(parsed.duplicates).toEqual([{ key: "same", sourcePath: "refs.bib" }]);
  });

  it("does not close parenthesized entries on a parenthesis inside a braced value", () => {
    const parsed = parseBibTeX("@article(paren, title={A) title}, year={2026})", "refs.bib");

    expect(parsed.entries[0].fields).toMatchObject({ title: "A) title", year: "2026" });
  });

  it("finds standard Pandoc citation groups and ignores email and code", () => {
    const markdown = [
      "Text [@kim2025; -@doe2020, p. 4].",
      "mail@example.com and `[@inline]`",
      "```md",
      "[@fenced]",
      "```",
    ].join("\n");

    expect(findCitationGroups(markdown)).toEqual([{
      from: 5,
      to: 32,
      line: 1,
      items: [
        { key: "kim2025", suppressAuthor: false, from: 6, to: 14, line: 1 },
        { key: "doe2020", suppressAuthor: true, from: 16, to: 25, line: 1 },
      ],
    }]);
  });
});
