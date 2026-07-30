import { describe, expect, it, vi } from "vitest";
import { filterPaletteItems, headingPaletteItems, type PaletteItem } from "./commandPalette";

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
});
