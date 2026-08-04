import { describe, expect, it } from "vitest";
import type { PropertyDocument } from "../ipc/bindings";
import { buildTagFacets, filterPropertyDocuments } from "./tagsPanel";

const documents: PropertyDocument[] = [
  {
    path: "C:/w/one.md",
    relativePath: "one.md",
    name: "one.md",
    title: "One",
    properties: { title: ["One"], tags: ["project", "한국어"], aliases: ["First"], lang: ["ko"] },
  },
  {
    path: "C:/w/two.md",
    relativePath: "notes/two.md",
    name: "two.md",
    title: "Two",
    properties: { tags: ["project"], lang: ["en"] },
  },
];

describe("Tags and property filters", () => {
  it("counts exact tag values and sorts by count then name", () => {
    expect(buildTagFacets(documents)).toEqual([
      { value: "project", count: 2 },
      { value: "한국어", count: 1 },
    ]);
  });

  it("matches complete property values instead of substrings", () => {
    expect(filterPropertyDocuments(documents, "tags", "project").map((document) => document.relativePath)).toEqual([
      "one.md",
      "notes/two.md",
    ]);
    expect(filterPropertyDocuments(documents, "tags", "proj")).toEqual([]);
    expect(filterPropertyDocuments(documents, "aliases", "First").map((document) => document.relativePath)).toEqual(["one.md"]);
    expect(filterPropertyDocuments(documents, "lang", "ko").map((document) => document.relativePath)).toEqual(["one.md"]);
  });
});
