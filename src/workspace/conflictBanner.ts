import { t } from "../i18n/i18n";

export interface ConflictBanner { show(): void; hide(): void; }

export function mountConflictBanner(
  container: HTMLElement,
  handlers: { onReload: () => void; onKeep: () => void },
): ConflictBanner {
  const bar = document.createElement("div");
  bar.className = "conflict-banner hidden";
  const msg = document.createElement("span");
  msg.className = "cb-msg";
  const reload = document.createElement("button");
  const keep = document.createElement("button");
  bar.append(msg, reload, keep);
  container.prepend(bar);
  const show = () => {
    msg.textContent = t("conflict.msg");
    reload.textContent = t("conflict.reload");
    keep.textContent = t("conflict.keep");
    bar.classList.remove("hidden");
  };
  const hide = () => bar.classList.add("hidden");
  reload.addEventListener("click", () => { hide(); handlers.onReload(); });
  keep.addEventListener("click", () => { hide(); handlers.onKeep(); });
  return { show, hide };
}
