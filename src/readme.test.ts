import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const at = (p: string) => new URL("../" + p, import.meta.url);
const readme = readFileSync(at("README.md"), "utf8");

describe("README", () => {
  it("keeps the core product sections", () => {
    for (const h of ["## What is Rune?", "## Features", "## Download", "## Why Rune?", "## Development", "## License"]) {
      expect(readme).toContain(h);
    }
  });
  it("links the v0.1.2 macOS dmg downloads", () => {
    expect(readme).toContain("Rune_0.1.2_aarch64.dmg");
    expect(readme).toContain("Rune_0.1.2_x64.dmg");
  });
  it("references the Korean mirror and the hero image", () => {
    expect(readme).toContain("README.ko.md");
    expect(readme).toContain("docs/hero.png");
  });
  it("ships LICENSE and the Korean mirror files", () => {
    expect(existsSync(at("LICENSE"))).toBe(true);
    expect(existsSync(at("README.ko.md"))).toBe(true);
  });
});
