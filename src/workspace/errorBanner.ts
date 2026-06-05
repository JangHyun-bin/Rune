import { t } from "../i18n/i18n";

export interface ErrorBanner { show(message: string): void; hide(): void; }

/** A dismissible error strip prepended to `container`. Mirrors conflictBanner. */
export function mountErrorBanner(container: HTMLElement): ErrorBanner {
  const bar = document.createElement("div");
  bar.className = "error-banner hidden";
  const msg = document.createElement("span");
  msg.className = "eb-msg";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  bar.append(msg, dismiss);
  container.prepend(bar);
  const hide = () => bar.classList.add("hidden");
  dismiss.addEventListener("click", hide);
  return {
    show(message: string) {
      msg.textContent = message;
      dismiss.textContent = t("error.dismiss");
      bar.classList.remove("hidden");
    },
    hide,
  };
}
