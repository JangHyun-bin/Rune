import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, serializeProject } from "./project";

const pathExists = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const writeFileIfUnchanged = vi.hoisted(() => vi.fn());
vi.mock("../ipc/bindings", () => ({ commands: { pathExists, readFile, writeFileIfUnchanged } }));

import { loadProjectManifest, saveProjectManifest } from "./projectManifest";

beforeEach(() => {
  pathExists.mockReset();
  readFile.mockReset();
  writeFileIfUnchanged.mockReset();
});

describe("project manifest persistence", () => {
  it("refuses to overwrite a manifest that changed after it was loaded", async () => {
    writeFileIfUnchanged.mockResolvedValue({ status: "ok", data: false });

    const result = await saveProjectManifest("C:\\book\\.rune-project.json", createProject("Book", ["a.md"]), "original");

    expect(result).toEqual({ status: "conflict" });
  });

  it("detects creation or deletion after the original manifest snapshot", async () => {
    writeFileIfUnchanged.mockResolvedValue({ status: "ok", data: false });
    expect(await saveProjectManifest("manifest", createProject("Book"), null)).toEqual({ status: "conflict" });
    expect(await saveProjectManifest("manifest", createProject("Book"), "deleted")).toEqual({ status: "conflict" });
  });

  it("writes only when the current source matches and returns the new snapshot", async () => {
    writeFileIfUnchanged.mockResolvedValue({ status: "ok", data: true });

    const result = await saveProjectManifest("manifest", createProject("Book", ["a.md"]), "original");

    expect(result).toEqual({ status: "saved", source: serializeProject(createProject("Book", ["a.md"])) });
    expect(writeFileIfUnchanged).toHaveBeenCalledWith("manifest", "original", result.status === "saved" ? result.source : "");
  });

  it("reports conditional write failures without claiming a conflict", async () => {
    writeFileIfUnchanged.mockResolvedValue({ status: "error", error: "denied" });
    expect(await saveProjectManifest("manifest", createProject("Book"), null)).toEqual({ status: "error" });
  });

  it("treats existence and read failures as errors, not as an absent manifest", async () => {
    pathExists.mockResolvedValueOnce({ status: "error", error: "denied" });
    expect(await loadProjectManifest("manifest")).toEqual({ status: "error" });

    pathExists.mockResolvedValueOnce({ status: "ok", data: true });
    readFile.mockResolvedValueOnce({ status: "error", error: "denied" });
    expect(await loadProjectManifest("manifest")).toEqual({ status: "error" });
  });
});
