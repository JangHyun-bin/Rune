import { describe, expect, it } from "vitest";
import { sortBacklinks } from "./backlinksPanel";

describe("Backlinks View", () => {
  it("orders source documents and occurrences deterministically", () => {
    expect(sortBacklinks([
      { path: "C:\\work\\z.md", name: "z.md", line: 2, href: "target.md" },
      { path: "C:\\work\\a.md", name: "a.md", line: 9, href: "target.md" },
      { path: "C:\\work\\a.md", name: "a.md", line: 3, href: "target.md" },
    ]).map(({ name, line }) => `${name}:${line}`)).toEqual(["a.md:3", "a.md:9", "z.md:2"]);
  });
});
