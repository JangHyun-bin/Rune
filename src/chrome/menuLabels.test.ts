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
    expect(labels["file.save"]).toBe("Save    Ctrl+S");
    expect(labels["file.saveAs"]).toBe("Save as…    Ctrl+Shift+S");
    expect(labels["app.quit"]).toBe("Quit");
    expect(labels["view.toggleSidebar"]).toBe("Toggle Primary Sidebar");
  });

  it("appends a shortcut hint only to ids with a real keyboard shortcut", () => {
    const labels = menuLabels();
    expect(labels["file.save"]).toBe("Save    Ctrl+S");
    expect(labels["file.saveAs"]).toBe("Save as…    Ctrl+Shift+S");
    expect(labels["file.open"]).toBe("Open file…    Ctrl+O");
    expect(labels["file.openFolder"]).toBe("Open folder…    Ctrl+Shift+O");
    expect(labels["file.exportHtml"]).toBe("Export to HTML    Ctrl+E");
    expect(labels["view.toggleFocusMode"]).toBe("Toggle focus mode    F8");
    expect(labels["file.newTab"]).toBe("New tab    Ctrl+N");
    // No real shortcut for these — no hint appended.
    expect(labels["file.exportPdf"]).toBe("Export to PDF");
    expect(labels["app.quit"]).toBe("Quit");
    expect(labels["view.toggleSidebar"]).toBe("Toggle Primary Sidebar");
    expect(labels["view.togglePanel"]).toBe("Toggle Panel");
    expect(labels["view.toggleTheme"]).toBe("Toggle theme");
    expect(labels["help.help"]).toBe("Keyboard shortcuts");
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
