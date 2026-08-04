import { describe, expect, it } from "vitest";
import { createProject } from "../project/project";
import { buildProjectChoices, projectManifestPath, projectRelativePath } from "./projectPanel";

describe("Project View data", () => {
  it("keeps selected files in project order and appends available files by path", () => {
    const project = createProject("Book", ["chapter.md", "missing.md"]);

    expect(buildProjectChoices(project, ["intro.md", "chapter.md", "appendix.md"])).toEqual([
      { path: "chapter.md", included: true, missing: false },
      { path: "missing.md", included: true, missing: true },
      { path: "appendix.md", included: false, missing: false },
      { path: "intro.md", included: false, missing: false },
    ]);
  });

  it("uses a root manifest and portable relative Markdown paths", () => {
    expect(projectManifestPath("C:\\notes")).toBe("C:\\notes\\.rune-project.json");
    expect(projectManifestPath("/notes/")).toBe("/notes/.rune-project.json");
    expect(projectRelativePath("C:\\notes", "C:\\notes\\chapters\\one.md")).toBe("chapters/one.md");
    expect(projectRelativePath("/notes", "/notes/intro.md")).toBe("intro.md");
    expect(() => projectRelativePath("/notes", "/other/secret.md")).toThrow();
  });
});
