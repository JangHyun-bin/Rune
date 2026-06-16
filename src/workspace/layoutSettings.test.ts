import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, normalizeLayoutSettings, parseLayoutSettingsJson, serializeLayoutSettings } from "./layoutSettings";

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
});
