import { findCitationGroups, referenceText, type CitationEntry, type CitationLibrary } from "../project/citations";
import { t } from "../i18n/i18n";

export interface ReferenceDocument {
  path: string;
  markdown: string;
}

export interface ReferenceOccurrence {
  path: string;
  line: number;
}

export interface ReferenceItem {
  key: string;
  status: "cited" | "uncited" | "missing";
  entry: CitationEntry | null;
  occurrences: ReferenceOccurrence[];
  active: boolean;
}

export type ReferencesPanelState = "noProject" | "loading" | "error" | ReferenceItem[];

export interface ReferencesPanel {
  render(state: ReferencesPanelState): void;
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function buildReferenceItems(
  library: CitationLibrary,
  documents: ReferenceDocument[],
  activePath: string | null,
): ReferenceItem[] {
  const entries = new Map(library.entries.map((entry) => [entry.key.toLocaleLowerCase(), entry]));
  const occurrences = new Map<string, { key: string; values: ReferenceOccurrence[] }>();
  for (const document of documents) {
    for (const group of findCitationGroups(document.markdown)) {
      for (const item of group.items) {
        const normalized = item.key.toLocaleLowerCase();
        const current = occurrences.get(normalized) ?? { key: entries.get(normalized)?.key ?? item.key, values: [] };
        current.values.push({ path: document.path, line: item.line });
        occurrences.set(normalized, current);
      }
    }
  }
  const keys = new Set([...entries.keys(), ...occurrences.keys()]);
  const items = [...keys].map((key): ReferenceItem => {
    const entry = entries.get(key) ?? null;
    const values = occurrences.get(key)?.values ?? [];
    values.sort((left, right) => Number(right.path === activePath) - Number(left.path === activePath)
      || left.path.localeCompare(right.path) || left.line - right.line);
    return {
      key: entry?.key ?? occurrences.get(key)?.key ?? key,
      status: !entry ? "missing" : values.length ? "cited" : "uncited",
      entry,
      occurrences: values,
      active: values.some((value) => value.path === activePath),
    };
  });
  const statusOrder = { cited: 0, missing: 1, uncited: 2 } as const;
  return items.sort((left, right) => Number(right.active) - Number(left.active)
    || Number(right.occurrences.length > 0) - Number(left.occurrences.length > 0)
    || statusOrder[left.status] - statusOrder[right.status]
    || left.key.localeCompare(right.key));
}

export function mountReferencesPanel(
  host: HTMLElement,
  onOpen: (path: string, line: number) => void,
): ReferencesPanel {
  let state: ReferencesPanelState = "noProject";
  host.className = "references-panel";
  host.tabIndex = 0;

  function draw(): void {
    host.setAttribute("aria-label", t("view.references"));
    host.replaceChildren();
    if (typeof state === "string" || state.length === 0) {
      const empty = document.createElement("div");
      empty.className = "references-empty";
      empty.textContent = t(typeof state === "string" ? `references.${state}` : "references.empty");
      host.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "references-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", t("view.references"));
    for (const item of state) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `reference-row ${item.status}`;
      row.disabled = item.occurrences.length === 0;
      const key = document.createElement("strong");
      key.textContent = `@${item.key}`;
      const detail = document.createElement("span");
      detail.textContent = item.entry ? referenceText(item.entry) : t("references.missing");
      const status = document.createElement("small");
      status.textContent = t(`references.${item.status}`, { count: item.occurrences.length });
      row.append(key, detail, status);
      const first = item.occurrences[0];
      if (first) row.addEventListener("click", () => onOpen(first.path, first.line));
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  draw();
  return {
    render(next) { state = Array.isArray(next) ? [...next] : next; draw(); },
    focus() {
      const row = host.querySelector<HTMLButtonElement>(".reference-row:not(:disabled)");
      if (row) row.focus();
      else host.focus();
    },
    relabel: draw,
    dispose() { host.replaceChildren(); },
  };
}
