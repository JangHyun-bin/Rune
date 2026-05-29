import { countWords } from "./wordcount";

export interface Chrome {
  setTitle(name: string, dirty: boolean): void;
  setStatus(text: string, line: number, col: number): void;
}

/** 상단바/상태바 DOM을 채우고 갱신 함수 + 테마 토글을 배선한다. */
export function mountChrome(titlebar: HTMLElement, statusbar: HTMLElement): Chrome {
  const title = document.createElement("span");
  title.className = "doc-title";
  const themeBtn = document.createElement("button");
  themeBtn.textContent = "테마";
  themeBtn.addEventListener("click", toggleTheme);
  const spacerL = document.createElement("span");
  spacerL.style.width = "40px"; // balance right button so title stays centered
  titlebar.replaceChildren(spacerL, title, themeBtn);

  const left = document.createElement("span");
  const right = document.createElement("span");
  statusbar.replaceChildren(left, right);

  applyTheme(savedTheme());

  return {
    setTitle(name, dirty) {
      title.replaceChildren();
      if (dirty) {
        const dot = document.createElement("span");
        dot.className = "dirty";
        dot.textContent = "● ";
        title.appendChild(dot);
      }
      title.appendChild(document.createTextNode(`${name} — cp_markdown`));
    },
    setStatus(text, line, col) {
      left.textContent = `${countWords(text)} 단어`;
      right.textContent = `줄 ${line}, 열 ${col}`;
    },
  };
}

function savedTheme(): "light" | "dark" {
  const saved = localStorage.getItem("cpmd-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(t: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("cpmd-theme", t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}
