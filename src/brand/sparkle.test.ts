import { describe, it, expect } from "vitest";
import { sparklePath, sparkleSvg } from "./sparkle";

describe("sparkle", () => {
  it("path is a closed move/curve string", () => {
    const d = sparklePath();
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d).toContain("Q"); // concave quad curves
  });
  it("svg embeds the path, viewBox, and size", () => {
    const s = sparkleSvg(20);
    expect(s).toContain("<svg");
    expect(s).toContain('viewBox="0 0 24 24"');
    expect(s).toContain('width="20"');
    expect(s).toContain("<path");
  });
  it("defaults fill to currentColor (CSS-controllable)", () => {
    expect(sparkleSvg()).toContain("currentColor");
  });
});
