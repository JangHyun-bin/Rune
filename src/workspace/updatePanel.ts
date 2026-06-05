import { t } from "../i18n/i18n";

export interface UpdatePanel {
  /** Auto mode (Win/Linux): "vX available [Update now][Later]". onUpdate runs the install. */
  showAuto(version: string, onUpdate: () => void): void;
  /** Manual mode (macOS): "vX available — [Download]". onDownload opens the Releases page. */
  showManual(version: string, onDownload: () => void): void;
  /** Switch the visible banner to a non-dismissable downloading state. */
  setDownloading(): void;
  hide(): void;
}

export function mountUpdateBanner(container: HTMLElement): UpdatePanel {
  const bar = document.createElement("div");
  bar.className = "update-banner hidden";
  const msg = document.createElement("span");
  msg.className = "ub-msg";
  const actions = document.createElement("span");
  actions.className = "ub-actions";
  bar.append(msg, actions);
  container.prepend(bar);

  const hide = () => bar.classList.add("hidden");
  const show = () => bar.classList.remove("hidden");

  return {
    showAuto(version, onUpdate) {
      msg.textContent = t("update.available", { v: version });
      actions.replaceChildren();
      const now = document.createElement("button");
      now.type = "button"; now.className = "btn btn-primary"; now.textContent = t("update.now");
      now.addEventListener("click", onUpdate);
      const later = document.createElement("button");
      later.type = "button"; later.className = "btn btn-secondary"; later.textContent = t("update.later");
      later.addEventListener("click", hide);
      actions.append(now, later);
      show();
    },
    showManual(version, onDownload) {
      msg.textContent = t("update.manualMac", { v: version });
      actions.replaceChildren();
      const dl = document.createElement("button");
      dl.type = "button"; dl.className = "btn btn-primary"; dl.textContent = t("update.download");
      dl.addEventListener("click", () => { onDownload(); hide(); });
      const later = document.createElement("button");
      later.type = "button"; later.className = "btn btn-secondary"; later.textContent = t("update.later");
      later.addEventListener("click", hide);
      actions.append(dl, later);
      show();
    },
    setDownloading() {
      msg.textContent = t("update.downloading");
      actions.replaceChildren();
      show();
    },
    hide,
  };
}
