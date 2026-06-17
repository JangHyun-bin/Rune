import { describe, expect, it } from "vitest";
import { normalizePaneWorkspaceSnapshot, serializePaneWorkspaceSnapshot } from "./panePersistence";

describe("pane persistence", () => {
  it("creates a single-pane snapshot from legacy open tabs", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(null, ["/w/a.md", "/w/b.md"]);
    expect(snapshot.root).toEqual({ type: "pane", paneId: "pane-1" });
    expect(snapshot.activePaneId).toBe("pane-1");
    expect(snapshot.panes).toEqual([
      { id: "pane-1", openTabs: ["/w/a.md", "/w/b.md"], activePath: "/w/a.md" },
    ]);
  });

  it("creates an empty single-pane snapshot with no legacy tabs", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(null, []);
    expect(snapshot.panes).toEqual([{ id: "pane-1", openTabs: [], activePath: null }]);
  });

  it("roundtrips a valid nested snapshot", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(
      {
        version: 1,
        root: {
          type: "split",
          direction: "row",
          ratios: [0.5, 0.5],
          children: [
            { type: "pane", paneId: "pane-1" },
            { type: "pane", paneId: "pane-2" },
          ],
        },
        activePaneId: "pane-2",
        panes: [
          { id: "pane-1", openTabs: ["/w/a.md"], activePath: "/w/a.md" },
          { id: "pane-2", openTabs: ["/w/b.md"], activePath: "/w/b.md" },
        ],
      },
      [],
    );
    expect(JSON.parse(serializePaneWorkspaceSnapshot(snapshot))).toEqual(snapshot);
  });

  it("filters invalid pane rows and falls back activePath to the first tab", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(
      {
        version: 1,
        root: {
          type: "split",
          direction: "column",
          ratios: [0.25, 0.75],
          children: [
            { type: "pane", paneId: "pane-1" },
            { type: "pane", paneId: "pane-2" },
          ],
        },
        activePaneId: "missing",
        panes: [
          { id: "pane-1", openTabs: ["/w/a.md", 12, "/w/b.md"], activePath: "/w/missing.md" },
          { id: "missing", openTabs: ["/w/c.md"], activePath: "/w/c.md" },
        ],
      },
      [],
    );

    expect(snapshot.activePaneId).toBe("pane-1");
    expect(snapshot.panes).toEqual([
      { id: "pane-1", openTabs: ["/w/a.md", "/w/b.md"], activePath: "/w/a.md" },
    ]);
  });
});
