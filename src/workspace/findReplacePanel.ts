import { t } from "../i18n/i18n";
import {
  findMatches,
  matchIndexAt,
  nextMatchIndex,
  previousMatchIndex,
  type MatchRange,
} from "./findReplace";

interface SelectOptions {
  focus?: boolean;
}

export interface FindReplacePanel {
  open: (initialQuery?: string) => void;
  close: () => void;
  toggle: () => void;
  refresh: () => void;
}

export interface FindReplaceHandlers {
  getText: () => string;
  getCursor: () => number;
  getSelectionText: () => string;
  getSelectionRange: () => MatchRange | null;
  selectRange: (from: number, to: number, options?: SelectOptions) => void;
  replaceRange: (from: number, to: number, insert: string) => void;
  replaceRanges: (ranges: MatchRange[], insert: string) => void;
}

export function mountFindReplacePanel(handlers: FindReplaceHandlers): FindReplacePanel {
  let open = false;
  let matches: MatchRange[] = [];
  let activeIndex = -1;

  const backdrop = document.createElement("div");
  backdrop.className = "fr-backdrop hidden";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const card = document.createElement("div");
  card.className = "fr-card";
  const queryRow = document.createElement("div");
  queryRow.className = "fr-row";
  const queryInput = document.createElement("input");
  queryInput.className = "fr-input";
  queryInput.placeholder = t("find.placeholder");
  const count = document.createElement("span");
  count.className = "fr-count";
  queryRow.append(queryInput, count);

  const replaceRow = document.createElement("div");
  replaceRow.className = "fr-row";
  const replaceInput = document.createElement("input");
  replaceInput.className = "fr-input";
  replaceInput.placeholder = t("find.replacePlaceholder");
  replaceRow.appendChild(replaceInput);

  const actions = document.createElement("div");
  actions.className = "fr-actions";
  const caseLabel = document.createElement("label");
  caseLabel.className = "fr-case";
  const caseToggle = document.createElement("input");
  caseToggle.type = "checkbox";
  const caseText = document.createElement("span");
  caseText.textContent = t("find.caseSensitive");
  caseLabel.append(caseToggle, caseText);

  const previousButton = button("find.previous");
  const nextButton = button("find.next");
  const replaceButton = button("find.replace");
  const replaceAllButton = button("find.replaceAll");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn btn-ghost fr-close";
  closeButton.textContent = "x";
  actions.append(caseLabel, previousButton, nextButton, replaceButton, replaceAllButton, closeButton);

  card.append(queryRow, replaceRow, actions);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function button(labelKey: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "btn btn-secondary";
    el.textContent = t(labelKey);
    return el;
  }

  function currentQuery(): string {
    return queryInput.value;
  }

  function relabel(): void {
    backdrop.setAttribute("aria-label", t("cmd.findReplace"));
    queryInput.placeholder = t("find.placeholder");
    replaceInput.placeholder = t("find.replacePlaceholder");
    caseText.textContent = t("find.caseSensitive");
    previousButton.textContent = t("find.previous");
    nextButton.textContent = t("find.next");
    replaceButton.textContent = t("find.replace");
    replaceAllButton.textContent = t("find.replaceAll");
  }

  function updateButtons(): void {
    const hasMatches = matches.length > 0;
    previousButton.disabled = !hasMatches;
    nextButton.disabled = !hasMatches;
    replaceButton.disabled = !hasMatches;
    replaceAllButton.disabled = !hasMatches;
  }

  function updateCount(): void {
    if (currentQuery().length === 0) {
      count.textContent = "";
    } else if (matches.length === 0) {
      count.textContent = t("find.noResults");
    } else {
      count.textContent = t("find.count", { current: activeIndex + 1, total: matches.length });
    }
    updateButtons();
  }

  function computeMatches(): void {
    matches = findMatches(handlers.getText(), currentQuery(), caseToggle.checked);
  }

  function selectIndex(index: number, focus = false): void {
    if (matches.length === 0 || index < 0) {
      activeIndex = -1;
      updateCount();
      return;
    }
    activeIndex = ((index % matches.length) + matches.length) % matches.length;
    const match = matches[activeIndex];
    handlers.selectRange(match.from, match.to, { focus });
    updateCount();
  }

  function refreshSelection(focus = false): void {
    computeMatches();
    if (matches.length === 0) {
      activeIndex = -1;
      updateCount();
      return;
    }

    const selected = matchIndexAt(matches, handlers.getSelectionRange());
    selectIndex(selected === -1 ? nextMatchIndex(matches, handlers.getCursor()) : selected, focus);
  }

  function refreshPassive(): void {
    computeMatches();
    if (matches.length === 0) {
      activeIndex = -1;
    } else {
      const selected = matchIndexAt(matches, handlers.getSelectionRange());
      if (selected !== -1) activeIndex = selected;
      else if (activeIndex >= matches.length) activeIndex = nextMatchIndex(matches, handlers.getCursor());
      else if (activeIndex === -1) activeIndex = nextMatchIndex(matches, handlers.getCursor());
    }
    updateCount();
  }

  function findNext(): void {
    computeMatches();
    if (matches.length === 0) {
      activeIndex = -1;
      updateCount();
      return;
    }
    const selected = matchIndexAt(matches, handlers.getSelectionRange());
    const fromIndex = selected === -1 ? nextMatchIndex(matches, handlers.getCursor()) : selected + 1;
    selectIndex(fromIndex, true);
  }

  function findPrevious(): void {
    computeMatches();
    if (matches.length === 0) {
      activeIndex = -1;
      updateCount();
      return;
    }
    const selected = matchIndexAt(matches, handlers.getSelectionRange());
    const fromIndex = selected === -1 ? previousMatchIndex(matches, handlers.getCursor()) : selected - 1;
    selectIndex(fromIndex, true);
  }

  function replaceCurrent(): void {
    computeMatches();
    if (matches.length === 0) {
      activeIndex = -1;
      updateCount();
      return;
    }
    const selected = matchIndexAt(matches, handlers.getSelectionRange());
    const index = selected === -1 ? nextMatchIndex(matches, handlers.getCursor()) : selected;
    const match = matches[index];
    handlers.replaceRange(match.from, match.to, replaceInput.value);
    computeMatches();
    selectIndex(nextMatchIndex(matches, match.from + replaceInput.value.length), true);
  }

  function replaceAll(): void {
    computeMatches();
    if (matches.length === 0) {
      updateCount();
      return;
    }
    handlers.replaceRanges(matches, replaceInput.value);
    computeMatches();
    selectIndex(nextMatchIndex(matches, handlers.getCursor()), true);
  }

  function show(initialQuery?: string): void {
    open = true;
    relabel();
    backdrop.classList.remove("hidden");
    const selected = handlers.getSelectionText();
    if (initialQuery !== undefined) {
      queryInput.value = initialQuery;
    } else if (selected && !selected.includes("\n") && selected.length <= 120) {
      queryInput.value = selected;
    }
    refreshSelection(false);
    queryInput.focus();
    queryInput.select();
  }

  function hide(): void {
    open = false;
    backdrop.classList.add("hidden");
  }

  queryInput.addEventListener("input", () => refreshSelection(false));
  caseToggle.addEventListener("change", () => refreshSelection(false));
  previousButton.addEventListener("click", findPrevious);
  nextButton.addEventListener("click", findNext);
  replaceButton.addEventListener("click", replaceCurrent);
  replaceAllButton.addEventListener("click", replaceAll);
  closeButton.addEventListener("click", hide);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) hide();
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrevious();
      else findNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  });
  replaceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) replaceAll();
      else replaceCurrent();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  });

  return {
    open: show,
    close: hide,
    toggle: () => (open ? hide() : show()),
    refresh: () => { if (open) refreshPassive(); },
  };
}
