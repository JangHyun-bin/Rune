import { describe, expect, it } from "vitest";
import {
  createProject,
  moveProjectFile,
  parseProject,
  serializeProject,
  setProjectFileIncluded,
  validateProject,
} from "./project";

describe("Rune project model", () => {
  it("parses and serializes the portable version 1 manifest", () => {
    const project = parseProject(JSON.stringify({
      version: 1,
      title: "  Research Book  ",
      files: ["intro.md", "chapters\\one.markdown"],
    }));

    expect(project).toEqual({
      version: 1,
      title: "Research Book",
      files: ["intro.md", "chapters/one.markdown"],
    });
    expect(serializeProject(project)).toBe(`{
  "version": 1,
  "title": "Research Book",
  "files": [
    "intro.md",
    "chapters/one.markdown"
  ]
}\n`);
  });

  it("rejects unsafe or unsupported manifest paths", () => {
    for (const path of ["../secret.md", "/absolute.md", "C:\\absolute.md", "image.png"]) {
      expect(() => parseProject(JSON.stringify({ version: 1, title: "Book", files: [path] }))).toThrow();
    }
  });

  it("reports duplicate and missing files without changing their order", () => {
    const project = parseProject(JSON.stringify({
      version: 1,
      title: "Book",
      files: ["one.md", "missing.md", "one.md"],
    }));

    expect(validateProject(project, ["one.md", "two.md"])).toEqual([
      { kind: "missing", path: "missing.md" },
      { kind: "duplicate", path: "one.md" },
    ]);
    expect(project.files).toEqual(["one.md", "missing.md", "one.md"]);
  });

  it("includes, excludes, and reorders files immutably", () => {
    const original = createProject("Book", ["one.md", "two.md"]);
    const included = setProjectFileIncluded(original, "three.md", true);
    const moved = moveProjectFile(included, "three.md", -1);
    const excluded = setProjectFileIncluded(moved, "one.md", false);

    expect(original.files).toEqual(["one.md", "two.md"]);
    expect(included.files).toEqual(["one.md", "two.md", "three.md"]);
    expect(moved.files).toEqual(["one.md", "three.md", "two.md"]);
    expect(excluded.files).toEqual(["three.md", "two.md"]);
  });
});
