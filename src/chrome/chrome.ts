import { countWords } from "./wordcount";
import { t } from "../i18n/i18n";

export interface Chrome {
  setTitle(name: string, dirty: boolean): void;
  setStatus(text: string, line: number, col: number): void;
  relabel(): void;
}

/** 상단바/상태바 DOM을 채우고 갱신 함수 + 테마 토글을 배선한다. 테마 영속화는 main이 소유한다. */
export function mountChrome(
  titlebar: HTMLElement,
  statusbar: HTMLElement,
  opts?: { onThemeChange?: (theme: "light" | "dark") => void },
): Chrome {
  const title = document.createElement("span");
  title.className = "doc-title";
  const themeBtn = document.createElement("button");
  themeBtn.textContent = t("theme.toggle");
  themeBtn.addEventListener("click", () => toggleTheme(opts?.onThemeChange));
  const spacerL = document.createElement("span");
  spacerL.style.width = "40px"; // balance right button so title stays centered
  titlebar.replaceChildren(spacerL, title, themeBtn);

  const left = document.createElement("span");
  const right = document.createElement("span");
  statusbar.replaceChildren(left, right);

  return {
    setTitle(name, dirty) {
      title.replaceChildren();
      if (dirty) {
        const dot = document.createElement("span");
        dot.className = "dirty";
        dot.textContent = "● ";
        title.appendChild(dot);
      }
      title.appendChild(document.createTextNode(`${name} — Rune`));
    },
    setStatus(text, line, col) {
      left.textContent = t("status.words", { n: countWords(text) });
      right.textContent = t("status.lineCol", { line, col });
    },
    relabel() {
      themeBtn.textContent = t("theme.toggle");
    },
  };
}

function toggleTheme(onThemeChange?: (theme: "light" | "dark") => void) {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  onThemeChange?.(next);
}
