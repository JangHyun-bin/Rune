import { countWords } from "./wordcount";
import { t } from "../i18n/i18n";
import { sparkleSvg } from "../brand/sparkle";

export interface Chrome {
  setTitle(name: string, dirty: boolean): void;
  setStatus(text: string, line: number, col: number): void;
  relabel(): void;
}

/** 상단바/상태바 DOM을 채우고 갱신 함수 + 설정 버튼(⚙)을 배선한다. 테마/설정은 main이 소유한다. */
export function mountChrome(
  titlebar: HTMLElement,
  statusbar: HTMLElement,
  opts?: {
    onTogglePrimarySidebar?: () => void;
    onToggleSecondarySidebar?: () => void;
    onTogglePanel?: () => void;
    onOpenSettings?: () => void;
  },
): Chrome {
  const spacer = document.createElement("span");
  spacer.className = "tb-spacer";
  const sidebarBtn = document.createElement("button");
  sidebarBtn.className = "tb-toggle-sidebar";
  sidebarBtn.textContent = "◫";
  sidebarBtn.title = t("workbench.togglePrimarySidebar");
  sidebarBtn.setAttribute("aria-label", t("workbench.togglePrimarySidebar"));
  sidebarBtn.addEventListener("click", () => opts?.onTogglePrimarySidebar?.());
  const secondarySidebarBtn = document.createElement("button");
  secondarySidebarBtn.className = "tb-toggle-sidebar";
  secondarySidebarBtn.textContent = "◧";
  secondarySidebarBtn.title = t("workbench.toggleSecondarySidebar");
  secondarySidebarBtn.setAttribute("aria-label", t("workbench.toggleSecondarySidebar"));
  secondarySidebarBtn.addEventListener("click", () => opts?.onToggleSecondarySidebar?.());
  const panelBtn = document.createElement("button");
  panelBtn.className = "tb-toggle-sidebar";
  panelBtn.textContent = "▤";
  panelBtn.title = t("workbench.togglePanel");
  panelBtn.setAttribute("aria-label", t("workbench.togglePanel"));
  panelBtn.addEventListener("click", () => opts?.onTogglePanel?.());
  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "⚙";
  settingsBtn.title = t("settings.title");
  settingsBtn.setAttribute("aria-label", t("settings.title"));
  settingsBtn.addEventListener("click", () => opts?.onOpenSettings?.());
  const brand = document.createElement("span");
  brand.className = "tb-brand";
  brand.innerHTML = sparkleSvg(18);
  titlebar.replaceChildren(brand, spacer, sidebarBtn, secondarySidebarBtn, panelBtn, settingsBtn);

  const left = document.createElement("span");
  const right = document.createElement("span");
  right.className = "sb-right";
  const lineCol = document.createElement("span");
  const autoSave = document.createElement("span");
  autoSave.className = "sb-autosave";
  autoSave.textContent = t("status.autosave");
  right.replaceChildren(lineCol, autoSave);
  statusbar.replaceChildren(left, right);

  return {
    setTitle(name, dirty) {
      document.title = dirty ? `${name} *` : name;
    },
    setStatus(text, line, col) {
      left.textContent = t("status.words", { n: countWords(text) });
      lineCol.textContent = t("status.lineCol", { line, col });
    },
    relabel() {
      sidebarBtn.title = t("workbench.togglePrimarySidebar");
      sidebarBtn.setAttribute("aria-label", t("workbench.togglePrimarySidebar"));
      secondarySidebarBtn.title = t("workbench.toggleSecondarySidebar");
      secondarySidebarBtn.setAttribute("aria-label", t("workbench.toggleSecondarySidebar"));
      panelBtn.title = t("workbench.togglePanel");
      panelBtn.setAttribute("aria-label", t("workbench.togglePanel"));
      settingsBtn.title = t("settings.title");
      settingsBtn.setAttribute("aria-label", t("settings.title"));
      autoSave.textContent = t("status.autosave");
    },
  };
}
