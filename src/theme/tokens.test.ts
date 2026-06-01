import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("light accent is Cobalt", () => expect(css).toMatch(/--accent:\s*#114ADB/i));
  it("paper surface present", () => expect(css).toMatch(/--faint:\s*#FAF8F6/i));
  it("dark theme uses Ink background", () =>
    expect(css).toMatch(/data-theme="dark"[\s\S]*?--bg:\s*#0D0F12/i));
  it("display + mono tokens declared", () => {
    expect(css).toMatch(/--display:/);
    expect(css).toMatch(/IBM Plex Mono/i);
  });
  it("layout tokens declared", () => {
    expect(css).toMatch(/--radius-md:/);
    expect(css).toMatch(/--shadow-lg:/);
    expect(css).toMatch(/--space-4:/);
  });
});
