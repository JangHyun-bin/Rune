import { describe, expect, it, vi } from "vitest";
import {
  createSettingsSaveScheduler,
  DEFAULT_LAYOUT,
  normalizeLayoutSettings,
  normalizePersistedWorkbenchLayout,
  parseLayoutSettingsJson,
  serializeLayoutSettings,
} from "./layoutSettings";
import { DEFAULT_WORKBENCH_LAYOUT, moveView } from "../workbench/workbenchLayout";

describe("layout settings", () => {
  it("fills missing values with defaults", () => {
    expect(normalizeLayoutSettings({ sidebarWidth: 320 })).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarWidth: 320,
    });
  });

  it("roundtrips version 2 layout and workbench state", () => {
    const moved = moveView(DEFAULT_WORKBENCH_LAYOUT, "outline", "auxiliary", 2);
    const workbench = {
      ...moved,
      parts: {
        ...moved.parts,
        primarySidebar: { ...moved.parts.primarySidebar, size: 360 },
        secondarySidebar: { ...moved.parts.secondarySidebar, visible: true },
      },
      views: {
        ...moved.views,
        outline: { ...moved.views.outline, visible: false, size: 180 },
      },
      positions: { primarySidebar: "right" as const, panel: "left" as const },
    };
    const json = serializeLayoutSettings({ sidebarWidth: 360, outlineHeight: 180, splitRatio: 0.62 }, workbench);
    expect(parseLayoutSettingsJson(json)).toEqual({
      layout: { sidebarWidth: 360, outlineHeight: 180, splitRatio: 0.62 },
      workbench,
    });
  });

  it("imports version 1 with default workbench handling", () => {
    expect(parseLayoutSettingsJson('{"version":1,"layout":{"sidebarWidth":300,"outlineHeight":160,"splitRatio":0.4}}')).toEqual({
      layout: { sidebarWidth: 300, outlineHeight: 160, splitRatio: 0.4 },
      workbench: null,
    });
  });

  it("also imports a plain legacy layout object", () => {
    expect(parseLayoutSettingsJson('{"sidebarWidth":300,"outlineHeight":160,"splitRatio":0.4}')).toEqual({
      layout: { sidebarWidth: 300, outlineHeight: 160, splitRatio: 0.4 },
      workbench: null,
    });
  });

  it("rejects a declared version 2 import with invalid workbench state", () => {
    expect(parseLayoutSettingsJson('{"version":2,"layout":{"sidebarWidth":300},"workbench":null}')).toBeNull();
  });

  it("rejects an unsupported versioned layout wrapper", () => {
    expect(parseLayoutSettingsJson('{"version":3,"layout":{"sidebarWidth":300}}')).toBeNull();
  });

  it("rejects invalid json", () => {
    expect(parseLayoutSettingsJson("{bad")).toBeNull();
  });

  it("rejects json without layout values", () => {
    expect(parseLayoutSettingsJson('{"foo":1}')).toBeNull();
  });

  it("migrates legacy sizes when workbench layout is missing", () => {
    const workbench = normalizePersistedWorkbenchLayout(null, {
      sidebarWidth: 320.5,
      outlineHeight: 176.25,
      splitRatio: 0.5,
    }, null);

    expect(workbench.parts.primarySidebar.size).toBe(321);
    expect(workbench.views.outline.size).toBe(176);
    expect(Number.isInteger(workbench.parts.primarySidebar.size)).toBe(true);
    expect(Number.isInteger(workbench.views.outline.size)).toBe(true);
  });

  it("migrates legacy sizes when workbench layout is invalid", () => {
    const workbench = normalizePersistedWorkbenchLayout({ version: 99 }, {
      sidebarWidth: null,
      outlineHeight: 184,
      splitRatio: 0.5,
    }, 326);

    expect(workbench.parts.primarySidebar.size).toBe(326);
    expect(workbench.views.outline.size).toBe(184);
  });

  it("blocks saves until async restore finishes, then debounces normally", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const scheduler = createSettingsSaveScheduler(save, 500);
      let finishRestore!: () => void;
      const restoring = new Promise<void>((resolve) => { finishRestore = resolve; });
      const restore = (async () => {
        scheduler.schedule();
        await restoring;
      })();
      const restoredAndEnabled = restore.then(() => scheduler.enable());

      await vi.advanceTimersByTimeAsync(500);
      expect(save).not.toHaveBeenCalled();

      finishRestore();
      expect(save).not.toHaveBeenCalled();
      await restoredAndEnabled;
      expect(save).toHaveBeenCalledTimes(1);

      scheduler.schedule();
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(499);
      expect(save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards restore-time saves after rejection and reopens for later changes", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const scheduler = createSettingsSaveScheduler(save, 500);
      const restore = (async () => {
        scheduler.schedule();
        throw new Error("restore failed");
      })();
      await restore.then(
        () => scheduler.enable(),
        () => scheduler.enable(false),
      );

      await vi.advanceTimersByTimeAsync(500);
      expect(save).not.toHaveBeenCalled();

      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(500);
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending debounced save before an explicit snapshot write", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const scheduler = createSettingsSaveScheduler(save, 500);
      scheduler.enable();

      scheduler.schedule();
      scheduler.cancelPending();
      await vi.advanceTimersByTimeAsync(500);

      expect(save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
