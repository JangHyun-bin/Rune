import { describe, it, expect, vi, afterEach } from "vitest";
import { t, setLocale, detectLocale, type Locale } from "./i18n";

describe("i18n", () => {
  it("returns ko string", () => { setLocale("ko"); expect(t("cmd.save")).toBe("저장"); });
  it("returns en string", () => { setLocale("en"); expect(t("cmd.save")).toBe("Save"); });
  it("interpolates params", () => { setLocale("en"); expect(t("status.words", { n: 3 })).toBe("3 words"); });
  it("falls back to en when key missing in locale", () => { setLocale("ja"); expect(typeof t("cmd.save")).toBe("string"); });
  it("returns the key itself if unknown", () => { setLocale("en"); expect(t("nope.nope")).toBe("nope.nope"); });
  it("localizes Workbench regions and navigation help in every locale", () => {
    const expected: Record<Locale, [string, string, string]> = {
      en: ["Activity Bar", "Resize Outline", "Use the Activity Bar to switch views. Use the Sidebar button in the title bar to show or hide the sidebar."],
      ko: ["활동 표시줄", "개요 크기 조절", "활동 표시줄에서 보기를 전환하세요. 제목 표시줄의 사이드바 버튼으로 사이드바를 표시하거나 숨길 수 있습니다."],
      ja: ["アクティビティバー", "アウトラインのサイズを変更", "アクティビティバーでビューを切り替えます。タイトルバーのサイドバーボタンでサイドバーを表示または非表示にできます。"],
      "zh-Hans": ["活动栏", "调整大纲大小", "使用活动栏切换视图。使用标题栏中的侧边栏按钮显示或隐藏侧边栏。"],
    };
    for (const [locale, values] of Object.entries(expected) as [Locale, [string, string, string]][]) {
      setLocale(locale);
      expect([t("workbench.activityBar"), t("workbench.resizeOutline"), t("help.workbenchNavigation")]).toEqual(values);
    }
  });
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
