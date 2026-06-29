import { t, getLocale, LOCALES, type Locale } from "../i18n/i18n";
import type { EditorMode } from "../editor/editor";
import { UI_SCALE_STEPS } from "../theme/scale";

export interface SettingsPanel { open: () => void; close: () => void; refresh: () => void; setUpdateStatus: (text: string) => void; }

export function mountSettingsPanel(handlers: {
  onLocale: (l: Locale) => void;
  onTheme: (theme: "light" | "dark") => void;
  getTheme: () => "light" | "dark";
  onEditorWidth: (w: "readable" | "wide") => void;
  getEditorWidth: () => "readable" | "wide";
  onEditorMode: (mode: EditorMode) => void;
  getEditorMode: () => EditorMode;
  onUiScale: (scale: number) => void;
  getUiScale: () => number;
  onHelp: () => void;
  onSetDefault: () => void;
  onCheckUpdates: () => void;
  onSaveLayout: () => void;
  onExportLayout: () => string;
  onImportLayout: (text: string) => boolean;
  onResetLayout: () => void;
  getLayoutSummary: () => string;
}): SettingsPanel {
  const backdrop = document.createElement("div"); backdrop.className = "settings-backdrop hidden";
  const card = document.createElement("div"); card.className = "settings-card";
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  let updateStatusEl: HTMLElement | null = null;
  let layoutStatusEl: HTMLElement | null = null;

  function setLayoutStatus(key: string): void {
    if (layoutStatusEl) layoutStatusEl.textContent = t(key);
  }

  function exportLayoutFile(): void {
    const blob = new Blob([handlers.onExportLayout()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rune-layout.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setLayoutStatus("layout.exported");
  }

  function build() {
    card.replaceChildren();
    const title = document.createElement("h2"); title.className = "settings-title"; title.textContent = t("settings.title");
    card.appendChild(title);

    // Language
    const langRow = document.createElement("div"); langRow.className = "settings-row";
    const langLabel = document.createElement("label"); langLabel.textContent = t("settings.language");
    const langSel = document.createElement("select");
    for (const { code, label } of LOCALES) {
      const o = document.createElement("option"); o.value = code; o.textContent = label;
      if (code === getLocale()) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.addEventListener("change", () => handlers.onLocale(langSel.value as Locale));
    langRow.append(langLabel, langSel); card.appendChild(langRow);

    // Theme
    const themeRow = document.createElement("div"); themeRow.className = "settings-row";
    const themeLabel = document.createElement("label"); themeLabel.textContent = t("settings.theme");
    const themeSel = document.createElement("select");
    for (const v of ["light", "dark"] as const) {
      const o = document.createElement("option"); o.value = v; o.textContent = t(v === "light" ? "theme.light" : "theme.dark");
      if (v === handlers.getTheme()) o.selected = true;
      themeSel.appendChild(o);
    }
    themeSel.addEventListener("change", () => handlers.onTheme(themeSel.value as "light" | "dark"));
    themeRow.append(themeLabel, themeSel); card.appendChild(themeRow);

    // Editor width
    const widthRow = document.createElement("div"); widthRow.className = "settings-row";
    const widthLabel = document.createElement("label"); widthLabel.textContent = t("settings.editorWidth");
    const widthSel = document.createElement("select");
    for (const v of ["readable", "wide"] as const) {
      const o = document.createElement("option"); o.value = v; o.textContent = t(v === "readable" ? "width.readable" : "width.wide");
      if (v === handlers.getEditorWidth()) o.selected = true;
      widthSel.appendChild(o);
    }
    widthSel.addEventListener("change", () => handlers.onEditorWidth(widthSel.value as "readable" | "wide"));
    widthRow.append(widthLabel, widthSel); card.appendChild(widthRow);

    // Editor mode
    const modeRow = document.createElement("div"); modeRow.className = "settings-row";
    const modeLabel = document.createElement("label"); modeLabel.textContent = t("settings.editorMode");
    const modeSel = document.createElement("select");
    for (const v of ["preview", "source", "split"] as const) {
      const o = document.createElement("option"); o.value = v; o.textContent = t(`editorMode.${v}`);
      if (v === handlers.getEditorMode()) o.selected = true;
      modeSel.appendChild(o);
    }
    modeSel.addEventListener("change", () => handlers.onEditorMode(modeSel.value as EditorMode));
    modeRow.append(modeLabel, modeSel); card.appendChild(modeRow);

    // UI size
    const uiRow = document.createElement("div"); uiRow.className = "settings-row";
    const uiLabel = document.createElement("label"); uiLabel.textContent = t("settings.uiScale");
    const uiSel = document.createElement("select");
    for (const step of UI_SCALE_STEPS) {
      const o = document.createElement("option"); o.value = String(step); o.textContent = `${Math.round(step * 100)}%`;
      if (step === handlers.getUiScale()) o.selected = true;
      uiSel.appendChild(o);
    }
    uiSel.addEventListener("change", () => handlers.onUiScale(Number(uiSel.value)));
    uiRow.append(uiLabel, uiSel); card.appendChild(uiRow);

    // Layout
    const layoutRow = document.createElement("div"); layoutRow.className = "settings-row settings-row-layout";
    const layoutLabel = document.createElement("label"); layoutLabel.textContent = t("settings.layout");
    const layoutWrap = document.createElement("div"); layoutWrap.className = "settings-layout";
    const layoutSummary = document.createElement("div"); layoutSummary.className = "settings-layout-summary"; layoutSummary.textContent = handlers.getLayoutSummary();
    const layoutActions = document.createElement("div"); layoutActions.className = "settings-layout-actions";
    const saveLayoutBtn = document.createElement("button"); saveLayoutBtn.type = "button"; saveLayoutBtn.className = "btn btn-secondary"; saveLayoutBtn.textContent = t("layout.save");
    saveLayoutBtn.addEventListener("click", () => { handlers.onSaveLayout(); setLayoutStatus("layout.saved"); });
    const exportLayoutBtn = document.createElement("button"); exportLayoutBtn.type = "button"; exportLayoutBtn.className = "btn btn-secondary"; exportLayoutBtn.textContent = t("layout.export");
    exportLayoutBtn.addEventListener("click", exportLayoutFile);
    const importLayoutBtn = document.createElement("button"); importLayoutBtn.type = "button"; importLayoutBtn.className = "btn btn-secondary"; importLayoutBtn.textContent = t("layout.import");
    const importInput = document.createElement("input"); importInput.type = "file"; importInput.accept = "application/json,.json"; importInput.className = "settings-file-input";
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        if (handlers.onImportLayout(text)) {
          layoutSummary.textContent = handlers.getLayoutSummary();
          setLayoutStatus("layout.imported");
        } else {
          setLayoutStatus("layout.importFailed");
        }
        importInput.value = "";
      });
    });
    importLayoutBtn.addEventListener("click", () => importInput.click());
    const resetLayoutBtn = document.createElement("button"); resetLayoutBtn.type = "button"; resetLayoutBtn.className = "btn btn-secondary"; resetLayoutBtn.textContent = t("layout.reset");
    resetLayoutBtn.addEventListener("click", () => {
      handlers.onResetLayout();
      layoutSummary.textContent = handlers.getLayoutSummary();
      setLayoutStatus("layout.resetDone");
    });
    layoutStatusEl = document.createElement("div"); layoutStatusEl.className = "settings-status";
    layoutActions.append(saveLayoutBtn, exportLayoutBtn, importLayoutBtn, resetLayoutBtn, importInput);
    layoutWrap.append(layoutSummary, layoutActions, layoutStatusEl);
    layoutRow.append(layoutLabel, layoutWrap); card.appendChild(layoutRow);

    // Shortcuts & help
    const helpRow = document.createElement("div"); helpRow.className = "settings-row";
    const helpLabel = document.createElement("label"); helpLabel.textContent = t("settings.help");
    const helpBtn = document.createElement("button"); helpBtn.type = "button"; helpBtn.className = "btn btn-secondary"; helpBtn.textContent = t("help.title");
    helpBtn.addEventListener("click", () => { hide(); handlers.onHelp(); });
    helpRow.append(helpLabel, helpBtn); card.appendChild(helpRow);

    // Default .md app
    const defRow = document.createElement("div"); defRow.className = "settings-row";
    const defLabel = document.createElement("label"); defLabel.textContent = t("settings.defaultApp");
    const defBtn = document.createElement("button"); defBtn.type = "button"; defBtn.className = "btn btn-secondary"; defBtn.textContent = t("settings.setDefault");
    defBtn.addEventListener("click", () => handlers.onSetDefault());
    defRow.append(defLabel, defBtn); card.appendChild(defRow);

    // Updates
    const upRow = document.createElement("div"); upRow.className = "settings-row";
    const upLabel = document.createElement("label"); upLabel.textContent = t("settings.updates");
    const upWrap = document.createElement("div"); upWrap.style.display = "flex"; upWrap.style.alignItems = "center"; upWrap.style.gap = "8px";
    updateStatusEl = document.createElement("span"); updateStatusEl.className = "settings-status";
    const upBtn = document.createElement("button"); upBtn.type = "button"; upBtn.className = "btn btn-secondary"; upBtn.textContent = t("settings.checkUpdates");
    upBtn.addEventListener("click", () => { updateStatusEl!.textContent = t("update.checking"); handlers.onCheckUpdates(); });
    upWrap.append(updateStatusEl, upBtn);
    upRow.append(upLabel, upWrap); card.appendChild(upRow);
  }

  const hide = () => backdrop.classList.add("hidden");
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.classList.contains("hidden")) hide(); });

  return {
    open: () => { build(); backdrop.classList.remove("hidden"); },
    close: hide,
    refresh: () => { if (!backdrop.classList.contains("hidden")) build(); },
    setUpdateStatus: (text: string) => { if (updateStatusEl) updateStatusEl.textContent = text; },
  };
}
