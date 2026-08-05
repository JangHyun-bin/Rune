import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "./project";

const readFile = vi.hoisted(() => vi.fn());
const pathExists = vi.hoisted(() => vi.fn());
const workspaceIndexLinkTargets = vi.hoisted(() => vi.fn());
vi.mock("../ipc/bindings", () => ({ commands: { readFile, pathExists, workspaceIndexLinkTargets } }));

import { hasFatalProjectDiagnostics, preflightProject } from "./projectPreflight";

const files = [
  { path: "a.md", absolutePath: "C:\\book\\a.md" },
  { path: "locked.md", absolutePath: "C:\\book\\locked.md" },
  { path: "b.md", absolutePath: "C:\\book\\b.md" },
];

const targets = [
  { path: "C:\\book\\a.md", relativePath: "a.md", href: "a.md", name: "a.md", title: "A", headings: [{ text: "Shared", level: 1, line: 1 }] },
  { path: "C:\\book\\b.md", relativePath: "b.md", href: "b.md", name: "b.md", title: "B", headings: [{ text: "Shared", level: 1, line: 1 }] },
];

beforeEach(() => {
  readFile.mockReset();
  pathExists.mockReset();
  workspaceIndexLinkTargets.mockReset();
  pathExists.mockResolvedValue({ status: "ok", data: true });
  workspaceIndexLinkTargets.mockResolvedValue({ status: "ok", data: targets });
});

describe("project preflight", () => {
  it("reports duplicate, missing, and unreadable project files as deterministic fatal diagnostics", async () => {
    readFile.mockImplementation(async (path: string) => path.endsWith("locked.md")
      ? { status: "error", error: "access denied" }
      : { status: "ok", data: "# A" });
    const project = createProject("Book", ["a.md", "missing.md", "locked.md", "a.md"]);

    const diagnostics = await preflightProject(project, "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "error", kind: "duplicateFile", path: "a.md", line: null, value: "a.md" },
      { severity: "error", kind: "missingFile", path: "missing.md", line: null, value: "missing.md" },
      { severity: "error", kind: "unreadableFile", path: "locked.md", line: null, value: "locked.md" },
    ]);
    expect(hasFatalProjectDiagnostics(diagnostics)).toBe(true);
  });

  it("namespaces IDs across documents while reporting broken links and unresolved relative images", async () => {
    const markdown = new Map([
      ["C:\\book\\a.md", "# Shared\n![local](assets/missing.png)\n[missing](gone.md)\n[ref broken][lost]\n\n[lost]: absent.markdown\n[^note]: one"],
      ["C:\\book\\b.md", "# Shared\n![remote](https://example.com/cover.png)\n![ref][cover]\n\n[cover]: assets/also-missing.png\n[^note]: two"],
    ]);
    readFile.mockImplementation(async (path: string) => ({ status: "ok", data: markdown.get(path) }));
    pathExists.mockResolvedValue({ status: "ok", data: false });
    const project = createProject("Book", ["a.md", "b.md"]);

    const diagnostics = await preflightProject(project, "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "warning", kind: "unresolvedImage", path: "a.md", line: 2, value: "assets/missing.png" },
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 3, value: "gone.md" },
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 4, value: "absent.markdown" },
      { severity: "warning", kind: "unresolvedImage", path: "b.md", line: 3, value: "assets/also-missing.png" },
    ]);
    expect(hasFatalProjectDiagnostics(diagnostics)).toBe(false);
  });

  it("reports missing local linked assets on Windows and POSIX paths", async () => {
    const fixtures = [
      { root: "C:\\book", file: { path: "a.md", absolutePath: "C:\\book\\a.md" }, target: targets[0] },
      { root: "/book", file: { path: "a.md", absolutePath: "/book/a.md" }, target: { ...targets[0], path: "/book/a.md" } },
    ];
    readFile.mockResolvedValue({ status: "ok", data: "[Guide](assets/missing.pdf?download=1#page=2)" });
    pathExists.mockResolvedValue({ status: "ok", data: false });

    for (const fixture of fixtures) {
      workspaceIndexLinkTargets.mockResolvedValue({ status: "ok", data: [fixture.target] });

      await expect(preflightProject(createProject("Book", ["a.md"]), fixture.root, [fixture.file])).resolves.toEqual([
        { severity: "warning", kind: "unresolvedResource", path: "a.md", line: 1, value: "assets/missing.pdf?download=1#page=2" },
      ]);
    }
  });

  it("uses the first duplicate normalized reference definition", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "[Guide][manual]\n\n[manual]: assets/missing.pdf\n[MANUAL]: assets/present.pdf" });
    pathExists.mockImplementation(async (path: string) => ({ status: "ok", data: !path.endsWith("missing.pdf") }));

    await expect(preflightProject(createProject("Book", ["a.md"]), "C:\\book", files)).resolves.toEqual([
      { severity: "warning", kind: "unresolvedResource", path: "a.md", line: 1, value: "assets/missing.pdf" },
    ]);
  });

  it("resolves query-suffixed Markdown destinations before checking resources", async () => {
    readFile.mockImplementation(async (path: string) => ({ status: "ok", data: path.endsWith("a.md") ? "[Chapter](b.md?download=1)" : "# Chapter" }));

    await expect(preflightProject(createProject("Book", ["a.md", "b.md"]), "C:\\book", files)).resolves.toEqual([]);
    expect(pathExists).not.toHaveBeenCalled();
  });

  it("reports invalid headings in percent-encoded Markdown destinations", async () => {
    readFile.mockImplementation(async (path: string) => ({ status: "ok", data: path.endsWith("a.md") ? "[Missing](b%2Emd#missing)" : "# Present" }));

    await expect(preflightProject(createProject("Book", ["a.md", "b.md"]), "C:\\book", files)).resolves.toEqual([
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 1, value: "b%2Emd#missing" },
    ]);
    expect(pathExists).not.toHaveBeenCalled();
  });

  it("reports duplicate heading and footnote IDs within one document", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "# Same\n# Same\n[^note]: One\n[^note]: Two" });

    const diagnostics = await preflightProject(createProject("Book", ["a.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "warning", kind: "duplicateHeadingId", path: "a.md", line: 1, value: "same" },
      { severity: "warning", kind: "duplicateHeadingId", path: "a.md", line: 2, value: "same" },
      { severity: "warning", kind: "duplicateFootnoteId", path: "a.md", line: 3, value: "note" },
      { severity: "warning", kind: "duplicateFootnoteId", path: "a.md", line: 4, value: "note" },
    ]);
  });

  it("reports links to workspace documents excluded from the project", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "[Excluded](b.md)" });

    const diagnostics = await preflightProject(createProject("Book", ["a.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 1, value: "b.md" },
    ]);
  });

  it("treats an unavailable Workspace Index as fatal instead of silently skipping link validation", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "[target](other.md)\n![cover](missing.png)" });
    pathExists.mockResolvedValue({ status: "ok", data: false });
    workspaceIndexLinkTargets.mockResolvedValue({ status: "error", error: "index unavailable" });

    const diagnostics = await preflightProject(createProject("Book", ["a.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "error", kind: "indexUnavailable", path: "a.md", line: null, value: "a.md" },
      { severity: "warning", kind: "unresolvedImage", path: "a.md", line: 2, value: "missing.png" },
    ]);
  });

  it("uses the selected document contents for heading links even when the index snapshot is stale", async () => {
    readFile.mockImplementation(async (path: string) => ({
      status: "ok",
      data: path.endsWith("a.md") ? "[Fresh](b.md#fresh)" : "# Fresh",
    }));
    workspaceIndexLinkTargets.mockResolvedValue({
      status: "ok",
      data: targets.map((target) => ({ ...target, headings: [] })),
    });

    const diagnostics = await preflightProject(createProject("Book", ["a.md", "b.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([]);
  });

  it("accepts an existing percent-encoded relative image after stripping query and fragment", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "![Cover](assets/My%20Cover.png?raw=1#preview)" });

    const diagnostics = await preflightProject(createProject("Book", ["a.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([]);
    expect(pathExists).toHaveBeenCalledWith("C:\\book\\assets\\My Cover.png");
  });

  it("does not publish relative images that escape the workspace root", async () => {
    readFile.mockResolvedValue({ status: "ok", data: "![Secret](../secret.png)" });

    const diagnostics = await preflightProject(createProject("Book", ["a.md"]), "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "warning", kind: "unresolvedImage", path: "a.md", line: 1, value: "../secret.png" },
    ]);
    expect(pathExists).not.toHaveBeenCalled();
  });
});
