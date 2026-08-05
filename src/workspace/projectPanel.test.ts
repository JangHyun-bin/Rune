import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/i18n";
import { createProject, serializeProject } from "../project/project";
import type { ProjectDiagnostic } from "../project/projectPreflight";

const pathExists = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const writeFileIfUnchanged = vi.hoisted(() => vi.fn());
vi.mock("../ipc/bindings", () => ({ commands: { pathExists, readFile, writeFileIfUnchanged } }));

import { buildProjectChoices, mountProjectPanel, projectManifestPath, projectRelativePath } from "./projectPanel";

type Listener = () => void;

class TestNode {
  children: TestNode[] = [];
  className = "";
  tagName: string;
  type = "";
  value = "";
  placeholder = "";
  checked = false;
  disabled = false;
  parent: TestNode | null = null;
  private text = "";
  private listeners = new Map<string, Listener[]>();
  private attributes = new Map<string, string>();

  constructor(tagName: string) { this.tagName = tagName.toLowerCase(); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string | null) { this.text = value ?? ""; this.children = []; }
  append(...children: TestNode[]): void { children.forEach((child) => this.appendChild(child)); }
  appendChild(child: TestNode): TestNode { child.parent = this; this.children.push(child); return child; }
  replaceChildren(...children: TestNode[]): void { this.children = []; this.append(...children); }
  addEventListener(type: string, listener: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  focus(): void {}
  descendants(): TestNode[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}

let host: TestNode;

beforeEach(() => {
  setLocale("en");
  host = new TestNode("div");
  pathExists.mockReset();
  readFile.mockReset();
  writeFileIfUnchanged.mockReset();
  pathExists.mockResolvedValue({ status: "ok", data: false });
  writeFileIfUnchanged.mockResolvedValue({ status: "ok", data: true });
  vi.stubGlobal("document", { createElement: (tagName: string) => new TestNode(tagName) });
});

afterEach(() => vi.unstubAllGlobals());

function button(label: string): TestNode {
  const found = host.descendants().find((node) => node.tagName === "button" && node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function includeFirstFile(): void {
  const checkbox = host.descendants().find((node) => node.tagName === "input" && node.type === "checkbox" && !node.checked);
  if (!checkbox) throw new Error("Missing project checkbox");
  checkbox.checked = true;
  checkbox.dispatch("change");
}

function labeledControl(label: string, tagName: string): TestNode {
  const row = host.descendants().find((node) => node.tagName === "label" && node.textContent.startsWith(label));
  const control = row?.descendants().find((node) => node.tagName === tagName);
  if (!control) throw new Error(`Missing ${label} control`);
  return control;
}

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

  it("shows file-scoped warnings and still publishes when preflight has no fatal issue", async () => {
    const warning: ProjectDiagnostic = { severity: "warning", kind: "unresolvedResource", path: "a.md", line: 3, value: "assets/gone.pdf" };
    const preflight = vi.fn().mockResolvedValue([warning]);
    const preview = vi.fn().mockResolvedValue(undefined);
    const panel = mountProjectPanel(host as unknown as HTMLElement, preflight, preview, vi.fn());
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);
    includeFirstFile();

    button("Preview").dispatch("click");

    await vi.waitFor(() => expect(preview).toHaveBeenCalledOnce());
    expect(host.textContent).toContain("a.md · Line 3");
    expect(host.textContent).toContain("Unresolved local linked asset: assets/gone.pdf");

    const title = host.descendants().find((node) => node.tagName === "input" && node.type === "text");
    if (!title) throw new Error("Missing project title");
    title.value = "Changed";
    title.dispatch("input");
    expect(host.textContent).not.toContain("Unresolved local linked asset: assets/gone.pdf");
  });

  it("blocks publishing on fatal preflight diagnostics", async () => {
    const fatal: ProjectDiagnostic = { severity: "error", kind: "unreadableFile", path: "a.md", line: null, value: "a.md" };
    const preview = vi.fn().mockResolvedValue(undefined);
    const panel = mountProjectPanel(host as unknown as HTMLElement, vi.fn().mockResolvedValue([fatal]), preview, vi.fn());
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);
    includeFirstFile();

    button("Preview").dispatch("click");

    await vi.waitFor(() => expect(host.textContent).toContain("Publishing is blocked"));
    expect(preview).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Unreadable project file: a.md");
  });

  it("does not overwrite a project manifest changed outside Rune", async () => {
    const original = serializeProject(createProject("Book", ["a.md"]));
    pathExists.mockResolvedValue({ status: "ok", data: true });
    readFile.mockResolvedValueOnce({ status: "ok", data: original });
    writeFileIfUnchanged.mockResolvedValue({ status: "ok", data: false });
    const panel = mountProjectPanel(host as unknown as HTMLElement, vi.fn(), vi.fn(), vi.fn());
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);

    button("Save project").dispatch("click");

    await vi.waitFor(() => expect(host.textContent).toContain("changed outside Rune"));
    expect(writeFileIfUnchanged).toHaveBeenCalled();
  });

  it("edits and persists the active publishing profile in the version 2 manifest", async () => {
    const panel = mountProjectPanel(host as unknown as HTMLElement, vi.fn(), vi.fn(), vi.fn());
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);
    includeFirstFile();
    const format = labeledControl("Format", "select");
    format.value = "pdf";
    format.dispatch("change");

    button("Save project").dispatch("click");

    await vi.waitFor(() => expect(writeFileIfUnchanged).toHaveBeenCalled());
    const contents = writeFileIfUnchanged.mock.calls.at(-1)?.[2] as string;
    const saved = JSON.parse(contents);
    expect(saved.version).toBe(2);
    expect(saved.publishing.profiles[0].format).toBe("pdf");
  });

  it("publishes again with the last successful profile and records success safely", async () => {
    const original = createProject("Book", ["a.md"]);
    original.publishing.lastSuccessfulProfileId = "default";
    pathExists.mockResolvedValue({ status: "ok", data: true });
    readFile.mockResolvedValue({ status: "ok", data: serializeProject(original) });
    const publish = vi.fn().mockResolvedValue(true);
    const panel = mountProjectPanel(host as unknown as HTMLElement, vi.fn().mockResolvedValue([]), vi.fn(), publish);
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);

    await panel.publishAgain();

    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][1]).toMatchObject({ id: "default", format: "html" });
    expect(writeFileIfUnchanged).toHaveBeenCalled();
    expect(host.textContent).toContain("Published with Default");
  });

  it("keeps the earlier successful profile when a PDF publish fails", async () => {
    const original = createProject("Book", ["a.md"]);
    original.publishing.profiles.push({
      ...original.publishing.profiles[0], id: "pdf", name: "PDF", format: "pdf",
    });
    original.publishing.activeProfileId = "pdf";
    original.publishing.lastSuccessfulProfileId = "default";
    pathExists.mockResolvedValue({ status: "ok", data: true });
    readFile.mockResolvedValue({ status: "ok", data: serializeProject(original) });
    const publish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const panel = mountProjectPanel(host as unknown as HTMLElement, vi.fn().mockResolvedValue([]), vi.fn(), publish);
    await panel.refresh("C:\\book", [{ path: "C:\\book\\a.md" }]);

    button("Publish").dispatch("click");

    await vi.waitFor(() => expect(host.textContent).toContain("Publishing failed"));
    expect(publish.mock.calls[0][1]).toMatchObject({ id: "pdf", format: "pdf" });
    expect(writeFileIfUnchanged).not.toHaveBeenCalled();

    await panel.publishAgain();

    expect(publish.mock.calls[1][1]).toMatchObject({ id: "default", format: "html" });
    const saved = JSON.parse(writeFileIfUnchanged.mock.calls[0][2] as string);
    expect(saved.publishing.lastSuccessfulProfileId).toBe("default");
  });
});
