import type { PathChangePlan } from "../ipc/bindings";
import { t } from "../i18n/i18n";

export function pathChangePreviewModel(plan: PathChangePlan) {
  return {
    source: plan.source,
    destination: plan.destination,
    confirmEnabled: plan.canApply,
    movedPaths: plan.pathChanges,
    documents: plan.edits.map((edit) => ({
      path: edit.path,
      resultingPath: edit.resultingPath,
      replacements: edit.replacements.map((replacement) => ({
        line: replacement.line,
        before: replacement.oldHref,
        after: replacement.newHref,
      })),
    })),
    issues: plan.issues.map((issue) => ({
      ...issue,
      label: t(`pathChange.issue.${issue.kind}`),
    })),
  };
}

function text(className: string, value: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = value;
  return element;
}

export function showPathChangePreview(plan: PathChangePlan): Promise<boolean> {
  return new Promise((resolve) => {
    const model = pathChangePreviewModel(plan);
    const previousFocus = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement("div");
    backdrop.className = "prompt-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", t("pathChange.previewTitle"));
    backdrop.tabIndex = -1;
    const card = document.createElement("div");
    card.className = "prompt-card path-change-preview";
    card.append(
      text("prompt-title", t("pathChange.previewTitle")),
      text("path-change-route", `${model.source} → ${model.destination}`),
    );

    if (model.movedPaths.length) {
      card.appendChild(text("path-change-section", t("pathChange.movedPaths")));
      const movedPaths = document.createElement("div");
      movedPaths.className = "path-change-list";
      for (const moved of model.movedPaths) {
        movedPaths.appendChild(text("path-change-item path-change-file", `${moved.from} → ${moved.to}`));
      }
      card.appendChild(movedPaths);
    }
    if (model.documents.length) {
      card.appendChild(text("path-change-section", t("pathChange.linkUpdates")));
      const changes = document.createElement("div");
      changes.className = "path-change-list";
      for (const documentEdit of model.documents) {
        const item = document.createElement("div");
        item.className = "path-change-item";
        item.appendChild(text("path-change-file", documentEdit.path));
        for (const replacement of documentEdit.replacements) {
          item.appendChild(text(
            "path-change-replacement",
            `${t("pathChange.line", { line: replacement.line })}: ${replacement.before} → ${replacement.after}`,
          ));
        }
        changes.appendChild(item);
      }
      card.appendChild(changes);
    }
    if (model.issues.length) {
      card.appendChild(text("path-change-section", t("pathChange.issues")));
      const issues = document.createElement("div");
      issues.className = "path-change-list";
      for (const issue of model.issues) {
        issues.appendChild(text(
          `path-change-item ${issue.blocking ? "is-blocking" : ""}`,
          `${issue.label}: ${issue.path}${issue.href ? ` — ${issue.href}` : ""}`,
        ));
      }
      card.appendChild(issues);
    }

    const row = document.createElement("div");
    row.className = "prompt-row";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = t("prompt.cancel");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-primary";
    confirm.textContent = t("pathChange.apply");
    confirm.disabled = !model.confirmEnabled;
    row.append(cancel, confirm);
    card.appendChild(row);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      backdrop.remove();
      previousFocus?.focus();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
    (model.confirmEnabled ? confirm : cancel).focus();
  });
}
