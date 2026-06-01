import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const fonts = readFileSync(new URL("./fonts.ts", import.meta.url), "utf8");

describe("brand fonts", () => {
  it("declares michroma + ibm-plex-mono deps", () => {
    expect(pkg.dependencies["@fontsource/michroma"]).toBeTruthy();
    expect(pkg.dependencies["@fontsource/ibm-plex-mono"]).toBeTruthy();
  });
  it("imports michroma + plex mono in fonts.ts", () => {
    expect(fonts).toContain("@fontsource/michroma");
    expect(fonts).toContain("@fontsource/ibm-plex-mono");
  });
});
