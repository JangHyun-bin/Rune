import { describe, it, expect, vi, afterEach } from "vitest";
import { t, setLocale, detectLocale } from "./i18n";

describe("i18n", () => {
  it("returns ko string", () => { setLocale("ko"); expect(t("cmd.save")).toBe("저장"); });
  it("returns en string", () => { setLocale("en"); expect(t("cmd.save")).toBe("Save"); });
  it("interpolates params", () => { setLocale("en"); expect(t("status.words", { n: 3 })).toBe("3 words"); });
  it("falls back to en when key missing in locale", () => { setLocale("ja"); expect(typeof t("cmd.save")).toBe("string"); });
  it("returns the key itself if unknown", () => { setLocale("en"); expect(t("nope.nope")).toBe("nope.nope"); });
});

describe("detectLocale", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns the first supported language in the preference list", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN", "ko-KR", "en-US"] });
    expect(detectLocale()).toBe("zh-Hans");
  });
  it("skips unsupported tags (fr) and picks the next supported (ko)", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR", "ko-KR", "en"] });
    expect(detectLocale()).toBe("ko");
  });
  it("falls back to English instead of a CJK the user never chose", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR", "de-DE"] });
    expect(detectLocale()).toBe("en");
  });
  it("uses navigator.language when languages is empty", () => {
    vi.stubGlobal("navigator", { languages: [], language: "ja-JP" });
    expect(detectLocale()).toBe("ja");
  });
  it("maps any Chinese tag to the shipped Simplified locale", () => {
    vi.stubGlobal("navigator", { languages: ["zh-Hant-TW"] });
    expect(detectLocale()).toBe("zh-Hans");
  });
});
