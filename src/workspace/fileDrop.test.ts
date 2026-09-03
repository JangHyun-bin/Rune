import { describe, expect, it, vi } from "vitest";
import { createNativeFileOpenQueue, handleInternalTabDrop, handleNativeFileDrop } from "./fileDrop";

describe("native file open queue", () => {
  it("keeps drained startup paths ahead of a live open-file event", async () => {
    let releaseInitial!: () => void;
    const initialBlocked = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const completed: string[] = [];
    const queue = createNativeFileOpenQueue(async (path) => {
      if (path.endsWith("initial.md")) await initialBlocked;
      completed.push(path);
      return true;
    });

    const live = queue.openLiveFile("C:/w/live.md");
    await Promise.resolve();
    expect(completed).toEqual([]);

    const drained = queue.drainLaunchFiles(["C:/w/initial.md", "C:/w/second.md"]);
    await Promise.resolve();
    expect(completed).toEqual([]);

    releaseInitial();
    await Promise.all([drained, live]);
    expect(completed).toEqual(["C:/w/initial.md", "C:/w/second.md", "C:/w/live.md"]);
  });

  it("continues after one native file open rejects", async () => {
    const started: string[] = [];
    const queue = createNativeFileOpenQueue(async (path) => {
      started.push(path);
      if (path.endsWith("broken.md")) throw new Error("read failed");
      return true;
    });

    await expect(queue.drainLaunchFiles(["C:/w/broken.md"])).rejects.toThrow("read failed");
    await expect(queue.openLiveFile("C:/w/later.md")).resolves.toBe(true);
    expect(started).toEqual(["C:/w/broken.md", "C:/w/later.md"]);
  });
});

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

describe("internal tab drop", () => {
  it("splits a pane from an edge target and moves the source tab (closes it)", async () => {
    const splitInPane = vi.fn(async () => "pane-2");
    const closeTab = vi.fn();

    await expect(handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: "C:/w/a.md", duplicate: false },
      target: { kind: "pane-edge", paneId: "pane-1", direction: "row", side: "after" },
      openInPane: vi.fn(),
      splitInPane,
      closeTab,
    })).resolves.toBe(true);

    expect(splitInPane).toHaveBeenCalledWith("pane-1", "C:/w/a.md", "row", "after");
    expect(closeTab).toHaveBeenCalledWith("pane-1", "tab-a");
  });

  it("keeps the source tab open when duplicating (Ctrl/Cmd drag)", async () => {
    const closeTab = vi.fn();

    await handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: "C:/w/a.md", duplicate: true },
      target: { kind: "pane-edge", paneId: "pane-1", direction: "column", side: "before" },
      openInPane: vi.fn(),
      splitInPane: vi.fn(async () => "pane-2"),
      closeTab,
    });

    expect(closeTab).not.toHaveBeenCalled();
  });

  it("moves the tab to a different pane's center", async () => {
    const openInPane = vi.fn(async () => true);
    const closeTab = vi.fn();

    await expect(handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: "C:/w/a.md", duplicate: false },
      target: { kind: "pane-center", paneId: "pane-2" },
      openInPane,
      splitInPane: vi.fn(),
      closeTab,
    })).resolves.toBe(true);

    expect(openInPane).toHaveBeenCalledWith("pane-2", "C:/w/a.md");
    expect(closeTab).toHaveBeenCalledWith("pane-1", "tab-a");
  });

  it("does nothing when dropped back on its own pane's center", async () => {
    const openInPane = vi.fn();
    const closeTab = vi.fn();

    await expect(handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: "C:/w/a.md", duplicate: false },
      target: { kind: "pane-center", paneId: "pane-1" },
      openInPane,
      splitInPane: vi.fn(),
      closeTab,
    })).resolves.toBe(false);

    expect(openInPane).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("does nothing for an untitled tab with no path", async () => {
    const splitInPane = vi.fn();
    const closeTab = vi.fn();

    await expect(handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: null, duplicate: false },
      target: { kind: "pane-edge", paneId: "pane-1", direction: "row", side: "after" },
      openInPane: vi.fn(),
      splitInPane,
      closeTab,
    })).resolves.toBe(false);

    expect(splitInPane).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("does not close the source tab when the split fails", async () => {
    const closeTab = vi.fn();

    await expect(handleInternalTabDrop({
      payload: { paneId: "pane-1", tabId: "tab-a", path: "C:/w/a.md", duplicate: false },
      target: { kind: "pane-edge", paneId: "pane-1", direction: "row", side: "after" },
      openInPane: vi.fn(),
      splitInPane: vi.fn(async () => null),
      closeTab,
    })).resolves.toBe(false);

    expect(closeTab).not.toHaveBeenCalled();
  });
});
