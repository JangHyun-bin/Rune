import { describe, it, expect, beforeEach } from "vitest";
import { setLocale } from "../i18n/i18n";
import { menuLabels } from "./menuLabels";

describe("menuLabels", () => {
  beforeEach(() => setLocale("en"));

  it("maps every menu id to its English text by default", () => {
    const labels = menuLabels();
    expect(labels["menu.file"]).toBe("File");
    expect(labels["menu.view"]).toBe("View");
    expect(labels["menu.help"]).toBe("Help");
    expect(labels["file.save"]).toBe("Save");
    expect(labels["file.saveAs"]).toBe("Save as…");
    expect(labels["app.quit"]).toBe("Quit");
    expect(labels["view.toggleSidebar"]).toBe("Toggle Primary Sidebar");
  });

  it("re-translates every key when the locale changes", () => {
    setLocale("ko");
    const labels = menuLabels();
    expect(labels["menu.file"]).toBe("파일");
    expect(labels["app.quit"]).toBe("종료");
  });

  it("has no id mapped to an empty string in any locale", () => {
    for (const locale of ["en", "ko", "ja", "zh-Hans"] as const) {
      setLocale(locale);
      const labels = menuLabels();
      for (const [id, text] of Object.entries(labels)) {
        expect(text.length, `${id} in ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});
