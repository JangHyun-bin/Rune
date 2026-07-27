import { describe, expect, it, vi } from "vitest";
import {
  createSettingsSaveScheduler,
  DEFAULT_LAYOUT,
  normalizeLayoutSettings,
  normalizePersistedWorkbenchLayout,
  parseLayoutSettingsJson,
  serializeLayoutSettings,
} from "./layoutSettings";

describe("layout settings", () => {
  it("fills missing values with defaults", () => {
    expect(normalizeLayoutSettings({ sidebarWidth: 320 })).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarWidth: 320,
    });
  });

  it("roundtrips the exported layout shape", () => {
    const json = serializeLayoutSettings({ sidebarWidth: 360, outlineHeight: 180, splitRatio: 0.62 });
    expect(parseLayoutSettingsJson(json)).toEqual({ sidebarWidth: 360, outlineHeight: 180, splitRatio: 0.62 });
  });

  it("also imports a plain layout object", () => {
    expect(parseLayoutSettingsJson('{"sidebarWidth":300,"outlineHeight":160,"splitRatio":0.4}')).toEqual({
      sidebarWidth: 300,
      outlineHeight: 160,
      splitRatio: 0.4,
    });
  });

  it("rejects invalid json", () => {
    expect(parseLayoutSettingsJson("{bad")).toBeNull();
  });

  it("rejects json without layout values", () => {
    expect(parseLayoutSettingsJson('{"foo":1}')).toBeNull();
  });

  it("migrates legacy sizes when workbench layout is missing", () => {
    const workbench = normalizePersistedWorkbenchLayout(null, {
      sidebarWidth: 318,
      outlineHeight: 176,
      splitRatio: 0.5,
    }, null);

    expect(workbench.parts.primarySidebar.size).toBe(318);
    expect(workbench.views.outline.size).toBe(176);
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
});
