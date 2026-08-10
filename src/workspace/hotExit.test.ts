import { describe, expect, it } from "vitest";
import {
  parseHotExitSnapshot,
  resolveHotExitTab,
  type HotExitSnapshot,
} from "./hotExit";

const snapshot: HotExitSnapshot = {
  version: 1,
  workspaceRoot: "C:/notes",
  activePaneId: "pane-1",
  panes: [{
    id: "pane-1",
    tabs: [{
      path: "C:/notes/draft.md",
      savedText: "# Saved\n",
      currentText: "# Recovered\n",
      active: true,
    }],
  }],
};

describe("Hot Exit recovery model", () => {
  it("accepts a complete versioned snapshot and rejects malformed nested tabs", () => {
    expect(parseHotExitSnapshot(snapshot)).toEqual(snapshot);
    expect(parseHotExitSnapshot({
      ...snapshot,
      panes: [{ id: "pane-1", tabs: [{ path: 42, savedText: "", currentText: "", active: true }] }],
    })).toBeNull();
  });

  it("restores a dirty file in place only when its disk base is unchanged", async () => {
    const recovered = await resolveHotExitTab(snapshot.panes[0].tabs[0], async () => "# Saved\n");

    expect(recovered).toEqual({
      kind: "file",
      path: "C:/notes/draft.md",
      savedText: "# Saved\n",
      currentText: "# Recovered\n",
      active: true,
    });
  });

  it("recovers as untitled instead of overwriting an externally changed file", async () => {
    const recovered = await resolveHotExitTab(snapshot.panes[0].tabs[0], async () => "# External edit\n");

    expect(recovered).toEqual({
      kind: "untitled",
      currentText: "# Recovered\n",
      recoveredFrom: "C:/notes/draft.md",
      active: true,
    });
  });

  it("does not duplicate recovery when autosave already wrote the current text", async () => {
    const recovered = await resolveHotExitTab(snapshot.panes[0].tabs[0], async () => "# Recovered\n");

    expect(recovered).toEqual({
      kind: "alreadySaved",
      path: "C:/notes/draft.md",
      currentText: "# Recovered\n",
      active: true,
    });
  });

  it("restores an unsaved untitled document without reading disk", async () => {
    let reads = 0;
    const recovered = await resolveHotExitTab({
      path: null,
      savedText: "",
      currentText: "unsaved thought",
      active: false,
    }, async () => {
      reads += 1;
      return null;
    });

    expect(reads).toBe(0);
    expect(recovered).toEqual({
      kind: "untitled",
      currentText: "unsaved thought",
      recoveredFrom: null,
      active: false,
    });
  });
});
