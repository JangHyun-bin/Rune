import { t } from "../i18n/i18n";

export interface ReadOnlyProperty {
  key: "title" | "tags" | "aliases" | "lang";
  values: string[];
}

export type ReadOnlyProperties =
  | { kind: "none" | "invalid" }
  | { kind: "properties"; entries: ReadOnlyProperty[] };

export interface PropertiesPanel {
  render(markdown: string | null): void;
  focus(): void;
  relabel(): void;
  dispose(): void;
}

const supportedKeys = ["title", "tags", "aliases", "lang"] as const;

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  return trimmed.length >= 2 && (first === '"' || first === "'") && trimmed[trimmed.length - 1] === first
    ? trimmed.slice(1, -1)
    : trimmed;
}

function inlineValues(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return [cleanScalar(trimmed)].filter(Boolean);
  if (!trimmed.endsWith("]")) return null;
  const values: string[] = [];
  let start = 1;
  let quote = "";
  for (let index = 1; index < trimmed.length - 1; index++) {
    const char = trimmed[index];
    if ((char === '"' || char === "'") && trimmed[index - 1] !== "\\") quote = quote === char ? "" : quote || char;
    if (char === "," && !quote) {
      values.push(cleanScalar(trimmed.slice(start, index)));
      start = index + 1;
    }
  }
  if (quote) return null;
  values.push(cleanScalar(trimmed.slice(start, -1)));
  return values.filter(Boolean);
}

export function parseReadOnlyProperties(markdown: string): ReadOnlyProperties {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { kind: "none" };
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (end < 0) return { kind: "invalid" };
  const values = new Map<ReadOnlyProperty["key"], string[]>();
  let listKey: ReadOnlyProperty["key"] | null = null;
  for (const line of lines.slice(1, end)) {
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && listKey) {
      values.get(listKey)?.push(cleanScalar(listItem[1]));
      continue;
    }
    if (/^\s/.test(line)) continue;
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) {
      listKey = null;
      continue;
    }
    const key = supportedKeys.find((candidate) => candidate === field[1]);
    if (!key) {
      listKey = null;
      continue;
    }
    if (values.has(key)) return { kind: "invalid" };
    if (field[2] === "") {
      values.set(key, []);
      listKey = key;
      continue;
    }
    const parsed = inlineValues(field[2]);
    if (!parsed || /^[{|>]/.test(field[2])) return { kind: "invalid" };
    values.set(key, parsed);
    listKey = null;
  }
  const entries = supportedKeys.flatMap((key) => values.has(key) ? [{ key, values: values.get(key)! }] : []);
  return entries.length ? { kind: "properties", entries } : { kind: "none" };
}

export function mountPropertiesPanel(host: HTMLElement): PropertiesPanel {
  let markdown: string | null = null;
  host.className = "properties-panel";
  host.tabIndex = 0;
  host.setAttribute("aria-label", t("view.properties"));

  function draw(): void {
    host.replaceChildren();
    const parsed = markdown === null ? { kind: "none" as const } : parseReadOnlyProperties(markdown);
    if (parsed.kind !== "properties") {
      const empty = document.createElement("div");
      empty.className = "properties-empty";
      empty.textContent = t(markdown === null ? "properties.noDocument" : `properties.${parsed.kind}`);
      host.appendChild(empty);
      return;
    }
    const list = document.createElement("dl");
    list.className = "properties-list";
    for (const entry of parsed.entries) {
      const key = document.createElement("dt");
      key.textContent = t(`properties.key.${entry.key}`);
      const value = document.createElement("dd");
      value.textContent = entry.values.join(", ");
      list.appendChild(key);
      list.appendChild(value);
    }
    host.appendChild(list);
  }

  draw();
  return {
    render(next) {
      markdown = next;
      draw();
    },
    focus: () => host.focus(),
    relabel() {
      host.setAttribute("aria-label", t("view.properties"));
      draw();
    },
    dispose() {
      host.replaceChildren();
    },
  };
}
