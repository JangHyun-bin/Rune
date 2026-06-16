import { t, getLocale, LOCALES, type Locale } from "../i18n/i18n";
import type { EditorMode } from "../editor/editor";

export interface SettingsPanel { open: () => void; close: () => void; refresh: () => void; setUpdateStatus: (text: string) => void; }

export function mountSettingsPanel(handlers: {
  onLocale: (l: Locale) => void;
  onTheme: (theme: "light" | "dark") => void;
  getTheme: () => "light" | "dark";
  onEditorWidth: (w: "readable" | "wide") => void;
  getEditorWidth: () => "readable" | "wide";
  onEditorMode: (mode: EditorMode) => void;
  getEditorMode: () => EditorMode;
  onHelp: () => void;
  onSetDefault: () => void;
  onCheckUpdates: () => void;
}): SettingsPanel {
  const backdrop = document.createElement("div"); backdrop.className = "settings-backdrop hidden";
  const card = document.createElement("div"); card.className = "settings-card";
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  let updateStatusEl: HTMLElement | null = null;

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
    for (const v of ["preview", "source"] as const) {
      const o = document.createElement("option"); o.value = v; o.textContent = t(v === "preview" ? "editorMode.preview" : "editorMode.source");
      if (v === handlers.getEditorMode()) o.selected = true;
      modeSel.appendChild(o);
    }
    modeSel.addEventListener("change", () => handlers.onEditorMode(modeSel.value as EditorMode));
    modeRow.append(modeLabel, modeSel); card.appendChild(modeRow);

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
