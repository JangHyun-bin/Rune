import { t } from "../i18n/i18n";
import { commands, type PropertyDocument, type PropertyKey } from "../ipc/bindings";

export interface TagFacet { value: string; count: number; }

export function buildTagFacets(documents: PropertyDocument[]): TagFacet[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const tag of new Set(document.properties.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function filterPropertyDocuments(documents: PropertyDocument[], key: PropertyKey, value: string): PropertyDocument[] {
  if (!value) return [];
  return documents.filter((document) => document.properties[key]?.includes(value));
}

export interface TagsPanel {
  refresh(root: string | null): Promise<void>;
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function mountTagsPanel(host: HTMLElement, openDocument: (path: string) => void): TagsPanel {
  let documents: PropertyDocument[] = [];
  let root: string | null = null;
  let key: PropertyKey = "tags";
  let query = "";
  let state: "idle" | "loading" | "error" = "idle";
  let request = 0;
  let filterInput: HTMLInputElement | null = null;
  host.className = "tags-panel";
  host.tabIndex = 0;

  function draw(): void {
    host.replaceChildren();
    host.setAttribute("aria-label", t("view.tags"));
    filterInput = null;
    if (!root || state !== "idle") {
      const empty = document.createElement("div");
      empty.className = "tags-empty";
      empty.textContent = t(!root ? "search.noFolder" : state === "loading" ? "search.searching" : "search.failed");
      host.appendChild(empty);
      return;
    }

    const controls = document.createElement("div");
    controls.className = "tags-controls";
    const select = document.createElement("select");
    select.className = "tags-key";
    select.setAttribute("aria-label", t("tags.property"));
    for (const propertyKey of ["tags", "title", "aliases", "lang"] as PropertyKey[]) {
      const option = document.createElement("option");
      option.value = propertyKey;
      option.textContent = t(`properties.key.${propertyKey}`);
      option.selected = propertyKey === key;
      select.appendChild(option);
    }
    select.addEventListener("change", () => { key = select.value as PropertyKey; renderResults(); });
    const input = document.createElement("input");
    input.className = "tags-filter";
    input.type = "search";
    input.value = query;
    input.placeholder = t("tags.filter");
    input.setAttribute("aria-label", t("tags.filter"));
    input.addEventListener("input", () => { query = input.value; renderResults(); });
    controls.append(select, input);
    filterInput = input;
    host.appendChild(controls);

    const facets = document.createElement("div");
    facets.className = "tag-facets";
    for (const facet of buildTagFacets(documents)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-facet";
      button.textContent = `${facet.value} ${facet.count}`;
      button.addEventListener("click", () => {
        key = "tags";
        query = facet.value;
        select.value = key;
        input.value = query;
        renderResults();
        input.focus();
      });
      facets.appendChild(button);
    }
    host.appendChild(facets);

    const summary = document.createElement("div");
    summary.className = "tags-summary";
    host.appendChild(summary);
    const list = document.createElement("div");
    list.className = "tags-results";
    host.appendChild(list);

    function renderResults(): void {
      const results = filterPropertyDocuments(documents, key, query);
      summary.textContent = t("search.results", { count: results.length });
      list.replaceChildren();
      for (const result of results) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tags-result";
        const title = document.createElement("strong");
        title.textContent = result.title;
        const path = document.createElement("span");
        path.textContent = result.relativePath;
        button.append(title, path);
        button.addEventListener("click", () => openDocument(result.path));
        list.appendChild(button);
      }
    }
    renderResults();
  }

  draw();
  return {
    async refresh(nextRoot) {
      root = nextRoot;
      documents = [];
      const current = ++request;
      if (!root) { state = "idle"; draw(); return; }
      state = "loading";
      draw();
      const result = await commands.workspaceIndexPropertyDocuments(root);
      if (current !== request) return;
      state = result.status === "ok" ? "idle" : "error";
      if (result.status === "ok") documents = result.data;
      draw();
    },
    focus: () => (filterInput ?? host).focus(),
    relabel: draw,
    dispose() { request++; host.replaceChildren(); },
  };
}
