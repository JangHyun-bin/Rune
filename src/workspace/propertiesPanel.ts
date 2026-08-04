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
type PropertyKey = ReadOnlyProperty["key"];
const listKeys = new Set<PropertyKey>(["tags", "aliases"]);

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (trimmed.length < 2 || (first !== '"' && first !== "'") || trimmed[trimmed.length - 1] !== first) return trimmed;
  if (first === "'") return trimmed.slice(1, -1).replace(/''/g, "'");
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
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

function serializedProperty(key: PropertyKey, values: string[], blockList = false): string[] | null {
  if (values.some((value) => /[\r\n]/.test(value))) return null;
  if (!listKeys.has(key)) {
    if (values.length !== 1) return null;
    return [`${key}: ${JSON.stringify(values[0])}`];
  }
  if (blockList) return [`${key}:`, ...values.map((value) => `  - ${JSON.stringify(value)}`)];
  return [`${key}: [${values.map((value) => JSON.stringify(value)).join(", ")}]`];
}

function hasUnquotedComment(value: string): boolean {
  let quote = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") quote = quote === char ? "" : quote || char;
    if (char === "#" && !quote && (index === 0 || /\s/.test(value[index - 1]))) return true;
  }
  return false;
}

/** Rewrites only the selected top-level field; every other byte is retained. */
export function updateProperty(markdown: string, key: PropertyKey, values: string[]): string | null {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(eol);
  if (lines[0]?.trim() !== "---") {
    const inserted = serializedProperty(key, values);
    if (!inserted || values.length === 0) return markdown;
    return ["---", ...inserted, "---", ...lines].join(eol);
  }

  const boundary = lines.findIndex((line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (boundary < 0) return null;
  const fieldPattern = /^([A-Za-z][\w-]*):\s*(.*)$/;
  const starts = lines.flatMap((line, index) => index > 0 && index < boundary && fieldPattern.exec(line)?.[1] === key ? [index] : []);
  if (starts.length > 1) return null;

  if (starts.length === 0) {
    if (values.length === 0) return markdown;
    const inserted = serializedProperty(key, values);
    if (!inserted) return null;
    lines.splice(boundary, 0, ...inserted);
    return lines.join(eol);
  }

  const start = starts[0];
  const field = fieldPattern.exec(lines[start]);
  if (!field) return null;
  let end = start + 1;
  while (end < boundary && (/^\s/.test(lines[end]) || lines[end] === "")) end++;

  const continuation = lines.slice(start + 1, end);
  const blockList = field[2] === "" && continuation.some((line) => line.trim() !== "");
  const safeBlockList = blockList && listKeys.has(key)
    && continuation.every((line) => line === "" || /^\s+-\s+.+$/.test(line));
  const safeInline = !continuation.some((line) => line.trim() !== "")
    && !/^[{|>]/.test(field[2])
    && !hasUnquotedComment(field[2])
    && inlineValues(field[2]) !== null;
  if (!safeBlockList && !safeInline) return null;

  if (values.length === 0) lines.splice(start, end - start);
  else {
    const replacement = serializedProperty(key, values, blockList);
    if (!replacement) return null;
    lines.splice(start, end - start, ...replacement);
  }
  return lines.join(eol);
}

export function mountPropertiesPanel(host: HTMLElement, onChange: (markdown: string) => void = () => {}): PropertiesPanel {
  let markdown: string | null = null;
  let firstControl: HTMLElement | null = null;
  host.className = "properties-panel";
  host.tabIndex = 0;
  host.setAttribute("aria-label", t("view.properties"));

  function draw(): void {
    host.replaceChildren();
    firstControl = null;
    const parsed = markdown === null ? { kind: "none" as const } : parseReadOnlyProperties(markdown);
    if (markdown === null || parsed.kind === "invalid") {
      const empty = document.createElement("div");
      empty.className = "properties-empty";
      empty.textContent = t(markdown === null ? "properties.noDocument" : "properties.invalid");
      host.appendChild(empty);
      return;
    }

    const current = new Map(parsed.kind === "properties" ? parsed.entries.map((entry) => [entry.key, entry.values]) : []);
    const form = document.createElement("div");
    form.className = "properties-form";
    for (const key of supportedKeys) {
      const row = document.createElement("label");
      row.className = "properties-field";
      const name = document.createElement("span");
      name.textContent = t(`properties.key.${key}`);
      const control = document.createElement(listKeys.has(key) ? "textarea" : "input");
      control.className = "properties-input";
      if (control instanceof HTMLTextAreaElement) control.rows = 2;
      else control.type = "text";
      control.value = (current.get(key) ?? []).join(listKeys.has(key) ? "\n" : "");
      control.addEventListener("change", () => {
        if (markdown === null) return;
        const values = listKeys.has(key)
          ? control.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
          : control.value.trim() ? [control.value.trim()] : [];
        const next = updateProperty(markdown, key, values);
        if (next === null) {
          control.setAttribute("aria-invalid", "true");
          return;
        }
        control.removeAttribute("aria-invalid");
        if (next !== markdown) onChange(next);
      });
      row.append(name, control);
      form.appendChild(row);
      firstControl ??= control;
    }
    host.appendChild(form);
  }

  draw();
  return {
    render(next) {
      markdown = next;
      draw();
    },
    focus: () => (firstControl ?? host).focus(),
    relabel() {
      host.setAttribute("aria-label", t("view.properties"));
      draw();
    },
    dispose() {
      host.replaceChildren();
    },
  };
}
