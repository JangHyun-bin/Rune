import type { EditorMode } from "../editor/editor";
import { t } from "../i18n/i18n";

export interface LayoutModeControl {
  setMode(mode: EditorMode): void;
  relabel(): void;
}

const MODES: EditorMode[] = ["preview", "source", "split"];

export function normalizeEditorMode(value: unknown): EditorMode {
  return value === "preview" || value === "source" || value === "split" ? value : "preview";
}

function labelForMode(mode: EditorMode): string {
  if (mode === "source") return t("editorMode.source");
  if (mode === "split") return t("editorMode.split");
  return t("editorMode.preview");
}

export function mountLayoutModeControl(
  parent: HTMLElement,
  getMode: () => EditorMode,
  onMode: (mode: EditorMode) => void,
): LayoutModeControl {
  const wrap = document.createElement("div");
  wrap.className = "layout-mode-control";
  parent.replaceChildren(wrap);

  function draw(): void {
    wrap.replaceChildren();
    for (const mode of MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "layout-mode-button" + (getMode() === mode ? " active" : "");
      button.textContent = labelForMode(mode);
      button.setAttribute("aria-pressed", String(getMode() === mode));
      button.addEventListener("click", () => onMode(mode));
      wrap.appendChild(button);
    }
  }

  draw();
  return {
    setMode: () => draw(),
    relabel: () => draw(),
  };
}
