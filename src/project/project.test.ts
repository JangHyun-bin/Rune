import { describe, expect, it } from "vitest";
import {
  activePublishingProfile,
  addPublishingProfile,
  createProject,
  deletePublishingProfile,
  markPublishingSuccessful,
  moveProjectFile,
  parseProject,
  replacePublishingProfile,
  serializeProject,
  setActivePublishingProfile,
  setProjectFileIncluded,
  validateProject,
} from "./project";

describe("Rune project model", () => {
  it("migrates version 1 manifests and preserves unknown top-level fields", () => {
    const project = parseProject(JSON.stringify({
      version: 1,
      title: "  Research Book  ",
      files: ["intro.md", "chapters\\one.markdown"],
      futureSetting: { keep: true },
    }));

    expect(project.version).toBe(2);
    expect(project.title).toBe("Research Book");
    expect(project.files).toEqual(["intro.md", "chapters/one.markdown"]);
    expect(project.extras).toEqual({ futureSetting: { keep: true } });
    expect(activePublishingProfile(project)).toMatchObject({
      id: "default",
      name: "Default",
      format: "html",
      outputDirectory: "exports",
    });

    const saved = JSON.parse(serializeProject(project));
    expect(saved.version).toBe(2);
    expect(saved.futureSetting).toEqual({ keep: true });
    expect(saved.publishing.profiles).toHaveLength(1);
  });

  it("roundtrips version 2 profile and metadata extension fields", () => {
    const base = JSON.parse(serializeProject(createProject("Book", ["one.md"])));
    base.publishing.futurePublishing = "keep";
    base.publishing.profiles[0].futureProfile = [1, 2];
    base.publishing.profiles[0].metadata.futureMetadata = true;

    const saved = JSON.parse(serializeProject(parseProject(JSON.stringify(base))));

    expect(saved.publishing.futurePublishing).toBe("keep");
    expect(saved.publishing.profiles[0].futureProfile).toEqual([1, 2]);
    expect(saved.publishing.profiles[0].metadata.futureMetadata).toBe(true);
  });

  it.each(["docx", "epub"] as const)("roundtrips the %s publishing format", (format) => {
    const manifest = JSON.parse(serializeProject(createProject("Book", ["one.md"])));
    manifest.publishing.profiles[0].format = format;

    expect(activePublishingProfile(parseProject(JSON.stringify(manifest))).format).toBe(format);
  });

  it("rejects unsafe document and publishing paths", () => {
    for (const path of ["../secret.md", "/absolute.md", "C:\\absolute.md", "image.png"]) {
      expect(() => parseProject(JSON.stringify({ version: 1, title: "Book", files: [path] }))).toThrow();
    }
    const manifest = JSON.parse(serializeProject(createProject("Book")));
    for (const outputDirectory of ["../outside", "/absolute", "C:\\absolute", "a//b"]) {
      manifest.publishing.profiles[0].outputDirectory = outputDirectory;
      expect(() => parseProject(JSON.stringify(manifest))).toThrow();
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

  it("creates, renames, duplicates, selects, deletes, and remembers profiles immutably", () => {
    const original = createProject("Book", ["one.md"]);
    const added = addPublishingProfile(original, "Print");
    const print = activePublishingProfile(added);
    const configured = replacePublishingProfile(added, {
      ...print,
      name: "Print Ready",
      format: "pdf",
      margins: { top: 10, right: 11, bottom: 12, left: 13 },
    });
    const duplicated = addPublishingProfile(configured, "Print Copy", activePublishingProfile(configured));
    const selected = setActivePublishingProfile(duplicated, "print");
    const successful = markPublishingSuccessful(selected, "print");
    const deleted = deletePublishingProfile(successful, "print");

    expect(original.publishing.profiles).toHaveLength(1);
    expect(configured.publishing.profiles.find((profile) => profile.id === "print")).toMatchObject({ name: "Print Ready", format: "pdf" });
    expect(activePublishingProfile(duplicated).id).toBe("print-copy");
    expect(successful.publishing.lastSuccessfulProfileId).toBe("print");
    expect(deleted.publishing.lastSuccessfulProfileId).toBeNull();
    expect(deleted.publishing.activeProfileId).not.toBe("print");
  });
});
