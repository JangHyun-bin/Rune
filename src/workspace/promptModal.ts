import { t } from "../i18n/i18n";

/** A single-input modal. Resolves with the trimmed value, or null if the user
 *  cancels (Escape / Cancel / backdrop) or submits an empty value. */
export function promptModal(opts: { title: string; value?: string; }): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "prompt-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", opts.title);
    const card = document.createElement("div");
    card.className = "prompt-card";
    const title = document.createElement("h2");
    title.className = "prompt-title";
    title.textContent = opts.title;
    const input = document.createElement("input");
    input.className = "prompt-input";
    input.type = "text";
    input.value = opts.value ?? "";
    const row = document.createElement("div");
    row.className = "prompt-row";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = t("prompt.cancel");
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-primary";
    ok.textContent = t("prompt.ok");
    row.append(cancel, ok);
    card.append(title, input, row);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      backdrop.remove();
      resolve(result);
    };
    const submit = () => {
      const v = input.value.trim();
      finish(v.length ? v : null);
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => finish(null));
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) finish(null); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.preventDefault(); finish(null); }
    });

    input.focus();
    input.select();
  });
}
