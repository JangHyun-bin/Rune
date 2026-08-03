import { describe, expect, it, vi } from "vitest";
import {
  collectWorkspaceHeadings,
  filterPaletteItems,
  headingPaletteItems,
  workspaceHeadingPaletteItems,
  type PaletteItem,
} from "./commandPalette";

describe("Command Palette heading navigation", () => {
  it("uses @ to show only matching headings from the current document", () => {
    const items: PaletteItem[] = [
      { label: "Open File", run: vi.fn() },
      { label: "Introduction", hint: "H1 · L1", scope: "heading", run: vi.fn() },
      { label: "Network Model", hint: "H2 · L8", scope: "heading", run: vi.fn() },
      { label: "@notes.md", run: vi.fn() },
    ];

    expect(filterPaletteItems(items, "@ net").map((item) => item.label)).toEqual([
      "Network Model",
    ]);
    expect(filterPaletteItems(items, "").map((item) => item.label)).toEqual([
      "Open File",
      "@notes.md",
    ]);
  });

  it("builds heading items that jump to the exact source line", () => {
    const jump = vi.fn();
    const items = headingPaletteItems("# Intro\ntext\n## Details", jump);

    expect(items.map(({ label, hint, scope }) => ({ label, hint, scope }))).toEqual([
      { label: "Intro", hint: "H1 · L1", scope: "heading" },
      { label: "Details", hint: "H2 · L3", scope: "heading" },
    ]);

    items[1].run();
    expect(jump).toHaveBeenCalledWith(3);
  });

  it("uses # to show only matching workspace headings", () => {
    const items: PaletteItem[] = [
      { label: "Open File", run: vi.fn() },
      { label: "Network Model", scope: "heading", run: vi.fn() },
      { label: "Network Model", scope: "workspaceHeading", hint: "design.md · H2 · L8", run: vi.fn() },
    ];

    expect(filterPaletteItems(items, "# net").map((item) => item.hint)).toEqual([
      "design.md · H2 · L8",
    ]);
  });

  it("collects headings from readable workspace files and skips failures", async () => {
    const read = vi.fn(async (path: string) => {
      if (path === "C:/w/broken.md") return null;
      return path.endsWith("active.md") ? "# Active\n## Details" : "# Other";
    });

    await expect(collectWorkspaceHeadings([
      { name: "active.md", path: "C:/w/active.md" },
      { name: "other.md", path: "C:/w/other.md" },
      { name: "broken.md", path: "C:/w/broken.md" },
    ], read)).resolves.toEqual([
      { text: "Active", level: 1, line: 1, name: "active.md", path: "C:/w/active.md" },
      { text: "Details", level: 2, line: 2, name: "active.md", path: "C:/w/active.md" },
      { text: "Other", level: 1, line: 1, name: "other.md", path: "C:/w/other.md" },
    ]);
  });

  it("reads only Markdown files when collecting workspace headings", async () => {
    const read = vi.fn(async () => "# Heading");

    await collectWorkspaceHeadings([
      { name: "notes.md", path: "C:/w/notes.md" },
      { name: "hero.png", path: "C:/w/hero.png" },
      { name: "draft.MARKDOWN", path: "C:/w/draft.MARKDOWN" },
    ], read);

    expect(read.mock.calls.map(([path]) => path)).toEqual([
      "C:/w/notes.md",
      "C:/w/draft.MARKDOWN",
    ]);
  });

  it("ranks the active document first and opens the exact heading", () => {
    const jump = vi.fn();
    const items = workspaceHeadingPaletteItems([
      { text: "Shared", level: 1, line: 4, name: "other.md", path: "C:/w/other.md" },
      { text: "Shared", level: 2, line: 7, name: "active.md", path: "C:/w/active.md" },
    ], "C:/w/active.md", jump);

    expect(items.map((item) => item.hint)).toEqual([
      "active.md · H2 · L7",
      "other.md · H1 · L4",
    ]);
    items[0].run();
    expect(jump).toHaveBeenCalledWith("C:/w/active.md", 7);
  });
});
