import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const at = (p: string) => new URL("../" + p, import.meta.url);
const readme = readFileSync(at("README.md"), "utf8");
const koreanReadme = readFileSync(at("README.ko.md"), "utf8");
const releaseWorkflow = readFileSync(at(".github/workflows/release.yml"), "utf8");

describe("README", () => {
  it("keeps the core product sections", () => {
    for (const h of ["## What is Rune?", "## Features", "## Download", "## Why Rune?", "## Development", "## License"]) {
      expect(readme).toContain(h);
    }
  });
  it("links the current macOS dmg downloads in both READMEs", () => {
    for (const document of [readme, koreanReadme]) {
      expect(document).toContain("Rune_0.1.21_aarch64.dmg");
      expect(document).toContain("Rune_0.1.21_x64.dmg");
    }
    expect(readme).toContain("signs, notarizes, staples, and verifies");
  });
  it("keeps the Korean release instructions readable", () => {
    expect(releaseWorkflow).toContain("다운로드: 아래 Assets에서 OS에 맞는 설치본을 받으세요.");
    expect(releaseWorkflow).toContain('"알 수 없는 게시자" 경고가 표시될 수 있습니다. 릴리스 워크플로에서');
    expect(releaseWorkflow).toContain("자동 설치와 앱 실행을 별도로 검증합니다.");
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
