import { describe, expect, it } from "vitest";
import { normalizeEditorMode } from "./layoutModeControl";

describe("normalizeEditorMode", () => {
  it("accepts preview, source, and split", () => {
    expect(normalizeEditorMode("preview")).toBe("preview");
    expect(normalizeEditorMode("source")).toBe("source");
    expect(normalizeEditorMode("split")).toBe("split");
  });

  it("falls back to preview for unknown values", () => {
    expect(normalizeEditorMode(null)).toBe("preview");
    expect(normalizeEditorMode("bad")).toBe("preview");
  });
});
