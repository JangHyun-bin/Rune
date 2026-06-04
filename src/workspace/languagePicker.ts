import { LOCALES, type Locale } from "../i18n/i18n";

// Rune's 4-point concave sparkle mark (matches the brand mark geometry).
const SPARK = "M 12,1 Q 13.65,10.35 23,12 Q 13.65,13.65 12,23 Q 10.35,13.65 1,12 Q 10.35,10.35 12,1 Z";

/**
 * First-run language chooser. Each language is shown in its OWN script, so the
 * dialog reads regardless of the current UI language. `detected` is the
 * best-effort guess and is pre-selected (Enter/Space accepts it). Resolves with
 * the chosen Locale. A choice is required — there is no dismiss-without-choosing.
 */
export function showLanguagePicker(detected: Locale): Promise<Locale> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "lang-picker-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Choose your language · 언어 선택");

    const card = document.createElement("div");
    card.className = "lang-picker-card";

    const mark = document.createElement("div");
    mark.className = "lang-picker-mark";
    mark.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK}" fill="currentColor"/></svg>`;

    const title = document.createElement("h1");
    title.className = "lang-picker-title";
    title.textContent = "Choose your language";

    const sub = document.createElement("p");
    sub.className = "lang-picker-sub";
    sub.textContent = "언어 · 言語 · 语言";

    const list = document.createElement("div");
    list.className = "lang-picker-list";

    const buttons: HTMLButtonElement[] = [];
    let chosen: Locale = detected;

    function done(l: Locale): void {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(l);
    }

    function paint(): void {
      buttons.forEach((b, i) => b.classList.toggle("is-selected", LOCALES[i].code === chosen));
    }

    function onKey(e: KeyboardEvent): void {
      const i = LOCALES.findIndex((x) => x.code === chosen);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const n = (i + 1) % LOCALES.length;
        chosen = LOCALES[n].code; buttons[n].focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = (i - 1 + LOCALES.length) % LOCALES.length;
        chosen = LOCALES[n].code; buttons[n].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); done(chosen);
      }
    }

    for (const { code, label } of LOCALES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lang-picker-opt";
      b.textContent = label;
      b.setAttribute("lang", code);
      b.addEventListener("click", () => done(code));
      b.addEventListener("focus", () => { chosen = code; paint(); });
      list.appendChild(b);
      buttons.push(b);
    }

    const hint = document.createElement("p");
    hint.className = "lang-picker-hint";
    hint.textContent = "F1 — Help · 도움말";

    paint();
    card.append(mark, title, sub, list, hint);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);

    const start = LOCALES.findIndex((x) => x.code === detected);
    requestAnimationFrame(() => (buttons[start] ?? buttons[0]).focus());
  });
}
