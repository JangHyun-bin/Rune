import { describe, expect, it, vi } from "vitest";
import { handleNativeFileDrop } from "./fileDrop";

describe("native file drop", () => {
  it("opens a Markdown file in the target tabbar pane", async () => {
    const openInPane = vi.fn(async () => true);

    await expect(handleNativeFileDrop({
      paths: ["C:/w/a.md"],
      target: { kind: "tabbar", paneId: "pane-1" },
      openInPane,
      splitInPane: vi.fn(),
    })).resolves.toBe(true);

    expect(openInPane).toHaveBeenCalledWith("pane-1", "C:/w/a.md");
  });

  it("opens a Markdown file in the target pane center", async () => {
    const openInPane = vi.fn(async () => true);

    await handleNativeFileDrop({
      paths: ["C:/w/a.markdown"],
      target: { kind: "pane-center", paneId: "pane-2" },
      openInPane,
      splitInPane: vi.fn(),
    });

    expect(openInPane).toHaveBeenCalledWith("pane-2", "C:/w/a.markdown");
  });

  it("splits a pane from an edge target", async () => {
    const splitInPane = vi.fn(async () => "pane-2");

    await expect(handleNativeFileDrop({
      paths: ["C:/w/a.md"],
      target: { kind: "pane-edge", paneId: "pane-1", direction: "row", side: "after" },
      openInPane: vi.fn(),
      splitInPane,
    })).resolves.toBe(true);

    expect(splitInPane).toHaveBeenCalledWith("pane-1", "C:/w/a.md", "row", "after");
  });

  it("ignores non-Markdown files and missing targets", async () => {
    const openInPane = vi.fn();
    const splitInPane = vi.fn();

    await expect(handleNativeFileDrop({
      paths: ["C:/w/a.txt"],
      target: { kind: "tabbar", paneId: "pane-1" },
      openInPane,
      splitInPane,
    })).resolves.toBe(false);
    await expect(handleNativeFileDrop({
      paths: ["C:/w/a.md"],
      target: { kind: "none", paneId: null },
      openInPane,
      splitInPane,
    })).resolves.toBe(false);

    expect(openInPane).not.toHaveBeenCalled();
    expect(splitInPane).not.toHaveBeenCalled();
  });
});
