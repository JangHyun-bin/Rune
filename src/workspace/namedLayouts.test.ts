import { describe, expect, it } from "vitest";
import {
  captureNamedLayout,
  createBuiltInLayout,
  deleteSavedLayout,
  namedLayoutChoices,
  normalizeSavedLayouts,
  resolveNamedLayout,
  selectedNamedLayoutValue,
  upsertSavedLayout,
} from "./namedLayouts";

describe("named workbench layouts", () => {
  it("creates a Research preset centered on workspace search", () => {
    const layout = createBuiltInLayout("research");

    expect(layout.workbenchLayout.parts.primarySidebar).toMatchObject({
      visible: true,
      activeContainerId: "search",
    });
    expect(layout.editorWidth).toBe("wide");
    expect(layout.editorMode).toBe("split");
  });

  it("captures a trimmed name without tabs by default", () => {
    const state = createBuiltInLayout("writing");
    const saved = captureNamedLayout("  Drafting  ", state, false);

    expect(saved).toMatchObject({ version: 1, name: "Drafting" });
    expect(saved).not.toHaveProperty("paneLayout");
  });

  it("captures an independent pane snapshot when tabs are included", () => {
    const state = {
      ...createBuiltInLayout("writing"),
      paneLayout: {
        version: 1 as const,
        root: { type: "pane" as const, paneId: "pane-1" },
        activePaneId: "pane-1",
        panes: [{ id: "pane-1", openTabs: ["/w/a.md"], activePath: "/w/a.md" }],
      },
    };

    const saved = captureNamedLayout("With tabs", state, true);
    state.paneLayout.panes[0].openTabs.push("/w/b.md");

    expect(saved?.paneLayout?.panes[0].openTabs).toEqual(["/w/a.md"]);
  });

  it("keeps only valid version 1 layouts from persisted settings", () => {
    const valid = captureNamedLayout("Drafting", createBuiltInLayout("writing"), false)!;

    expect(normalizeSavedLayouts([
      { ...valid, name: " " },
      { ...valid, name: "Broken", workbenchLayout: { version: 99 } },
      valid,
    ])).toEqual([valid]);
  });

  it("migrates saved layouts created before auxiliary views existed", () => {
    const valid = captureNamedLayout("Legacy", createBuiltInLayout("writing"), false)!;
    const legacy = {
      ...valid,
      workbenchLayout: {
        ...valid.workbenchLayout,
        views: {
          workspace: valid.workbenchLayout.views.workspace,
          outline: valid.workbenchLayout.views.outline,
          search: valid.workbenchLayout.views.search,
        },
      },
    };

    const [migrated] = normalizeSavedLayouts([legacy]);

    expect(migrated.name).toBe("Legacy");
    expect(migrated.workbenchLayout.views.backlinks.containerId).toBe("auxiliary");
    expect(migrated.workbenchLayout.views.properties.containerId).toBe("auxiliary");
  });

  it("overwrites an existing name case-insensitively without reordering it", () => {
    const writing = captureNamedLayout("Drafting", createBuiltInLayout("writing"), false)!;
    const research = captureNamedLayout("Research notes", createBuiltInLayout("research"), false)!;
    const replacement = captureNamedLayout("DRAFTING", createBuiltInLayout("review"), false)!;

    const result = upsertSavedLayout([writing, research], replacement);

    expect(result.map((layout) => layout.name)).toEqual(["DRAFTING", "Research notes"]);
    expect(result[0].editorMode).toBe("split");
  });

  it("deletes only the matching saved layout", () => {
    const writing = captureNamedLayout("Drafting", createBuiltInLayout("writing"), false)!;
    const research = captureNamedLayout("Research notes", createBuiltInLayout("research"), false)!;

    expect(deleteSavedLayout([writing, research], "DRAFTING")).toEqual([research]);
  });

  it("retains a valid included pane snapshot after settings normalization", () => {
    const state = {
      ...createBuiltInLayout("writing"),
      paneLayout: {
        version: 1 as const,
        root: { type: "pane" as const, paneId: "pane-1" },
        activePaneId: "pane-1",
        panes: [{ id: "pane-1", openTabs: ["/w/a.md"], activePath: "/w/a.md" }],
      },
    };
    const saved = captureNamedLayout("With tabs", state, true)!;

    expect(normalizeSavedLayouts([saved])[0].paneLayout).toEqual(state.paneLayout);
  });

  it("drops malformed included tabs without discarding the layout", () => {
    const saved = captureNamedLayout("Drafting", createBuiltInLayout("writing"), false)!;
    const malformed = {
      ...saved,
      paneLayout: {
        version: 1,
        root: { type: "pane", paneId: 42 },
        activePaneId: "pane-1",
        panes: [],
      },
    };

    expect(normalizeSavedLayouts([malformed])[0]).not.toHaveProperty("paneLayout");
  });

  it("keeps built-in and saved layout choices collision-safe", () => {
    const saved = captureNamedLayout("Writing", createBuiltInLayout("review"), false)!;

    expect(namedLayoutChoices([saved])).toEqual([
      { value: "builtin:writing", builtIn: true, name: "writing" },
      { value: "builtin:research", builtIn: true, name: "research" },
      { value: "builtin:review", builtIn: true, name: "review" },
      { value: "saved:Writing", builtIn: false, name: "Writing" },
    ]);
  });

  it("resolves only known built-in or saved choices", () => {
    const saved = captureNamedLayout("Drafting", createBuiltInLayout("review"), false)!;

    expect(resolveNamedLayout("builtin:research", [saved])?.workbenchLayout.parts.primarySidebar.activeContainerId).toBe("search");
    expect(resolveNamedLayout("saved:Drafting", [saved])).toEqual(saved);
    expect(resolveNamedLayout("saved:Missing", [saved])).toBeNull();
  });

  it("preserves the active layout selection after the settings UI rebuilds", () => {
    const choices = namedLayoutChoices([]);

    expect(selectedNamedLayoutValue(choices, "builtin:research")).toBe("builtin:research");
    expect(selectedNamedLayoutValue(choices, "saved:missing")).toBe("builtin:writing");
  });
});
