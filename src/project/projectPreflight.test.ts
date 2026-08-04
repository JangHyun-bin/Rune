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

  it("finds duplicate IDs, broken inline and reference links, and unresolved relative images as warnings", async () => {
    const markdown = new Map([
      ["C:\\book\\a.md", "# Shared\n![local](assets/missing.png)\n[missing](gone.md)\n[ref broken][lost]\n\n[lost]: absent.markdown\n[^note]: one"],
      ["C:\\book\\b.md", "# Shared\n![remote](https://example.com/cover.png)\n![ref][cover]\n\n[cover]: assets/also-missing.png\n[^note]: two"],
    ]);
    readFile.mockImplementation(async (path: string) => ({ status: "ok", data: markdown.get(path) }));
    pathExists.mockResolvedValue({ status: "ok", data: false });
    const project = createProject("Book", ["a.md", "b.md"]);

    const diagnostics = await preflightProject(project, "C:\\book", files);

    expect(diagnostics).toEqual([
      { severity: "warning", kind: "duplicateHeadingId", path: "a.md", line: 1, value: "shared" },
      { severity: "warning", kind: "unresolvedImage", path: "a.md", line: 2, value: "assets/missing.png" },
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 3, value: "gone.md" },
      { severity: "warning", kind: "brokenLink", path: "a.md", line: 4, value: "absent.markdown" },
      { severity: "warning", kind: "duplicateFootnoteId", path: "a.md", line: 7, value: "note" },
      { severity: "warning", kind: "duplicateHeadingId", path: "b.md", line: 1, value: "shared" },
      { severity: "warning", kind: "unresolvedImage", path: "b.md", line: 3, value: "assets/also-missing.png" },
      { severity: "warning", kind: "duplicateFootnoteId", path: "b.md", line: 6, value: "note" },
    ]);
    expect(hasFatalProjectDiagnostics(diagnostics)).toBe(false);
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
});
