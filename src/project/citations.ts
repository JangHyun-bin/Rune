export interface CitationEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  sourcePath: string;
}

export interface DuplicateCitationKey {
  key: string;
  sourcePath: string;
}

export interface CitationItem {
  key: string;
  suppressAuthor: boolean;
  from: number;
  to: number;
  line: number;
}

export interface CitationGroup {
  from: number;
  to: number;
  line: number;
  items: CitationItem[];
}

export interface CitationLibrary {
  entries: CitationEntry[];
  duplicates: DuplicateCitationKey[];
}

function closingDelimiter(source: string, open: number): number {
  const opening = source[open];
  const closing = opening === "{" ? "}" : ")";
  let depth = 1;
  let braces = 0;
  let quoted = false;
  for (let index = open + 1; index < source.length; index++) {
    const character = source[index];
    if (character === '"' && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (opening === "{") {
      if (character === opening) depth++;
      else if (character === closing && --depth === 0) return index;
    } else if (character === "{") braces++;
    else if (character === "}") braces--;
    else if (braces === 0 && character === opening) depth++;
    else if (braces === 0 && character === closing && --depth === 0) return index;
  }
  return -1;
}

function topLevelComma(source: string, start = 0): number {
  let braces = 0;
  let quoted = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === '"' && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (character === "{") braces++;
    else if (character === "}") braces--;
    else if (character === "," && braces === 0) return index;
  }
  return source.length;
}

function fieldValue(source: string, start: number): { value: string; end: number } {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index++;
  const opening = source[index];
  if (opening === "{" || opening === '"') {
    const closing = opening === "{" ? "}" : '"';
    let depth = opening === "{" ? 1 : 0;
    const from = ++index;
    for (; index < source.length; index++) {
      const character = source[index];
      if (opening === "{" && character === "{") depth++;
      else if (opening === "{" && character === "}" && --depth === 0) break;
      else if (opening === '"' && character === closing && source[index - 1] !== "\\") break;
    }
    return { value: source.slice(from, index).trim().replace(/\s+/g, " "), end: index + 1 };
  }
  const end = topLevelComma(source, index);
  return { value: source.slice(index, end).trim(), end };
}

function parseFields(source: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (/[\s,]/.test(source[index] ?? "")) index++;
    const match = source.slice(index).match(/^([A-Za-z][\w-]*)\s*=/);
    if (!match) break;
    index += match[0].length;
    const parsed = fieldValue(source, index);
    fields[match[1].toLowerCase()] = parsed.value;
    index = parsed.end;
  }
  return fields;
}

export function parseBibTeX(source: string, sourcePath = ""): CitationLibrary {
  const entries: CitationEntry[] = [];
  const duplicates: DuplicateCitationKey[] = [];
  const keys = new Set<string>();
  const header = /@([A-Za-z]+)\s*([({])/g;
  for (let match = header.exec(source); match; match = header.exec(source)) {
    const open = header.lastIndex - 1;
    const close = closingDelimiter(source, open);
    if (close < 0) break;
    header.lastIndex = close + 1;
    const type = match[1].toLowerCase();
    if (type === "comment" || type === "preamble" || type === "string") continue;
    const body = source.slice(open + 1, close);
    const comma = topLevelComma(body);
    if (comma === body.length) continue;
    const key = body.slice(0, comma).trim();
    if (!key) continue;
    const normalizedKey = key.toLocaleLowerCase();
    if (keys.has(normalizedKey)) {
      duplicates.push({ key, sourcePath });
      continue;
    }
    keys.add(normalizedKey);
    entries.push({ key, type, fields: parseFields(body.slice(comma + 1)), sourcePath });
  }
  return { entries, duplicates };
}

export function mergeCitationLibraries(libraries: CitationLibrary[]): CitationLibrary {
  const entries: CitationEntry[] = [];
  const duplicates: DuplicateCitationKey[] = [];
  const keys = new Set<string>();
  for (const library of libraries) {
    duplicates.push(...library.duplicates);
    for (const entry of library.entries) {
      const key = entry.key.toLocaleLowerCase();
      if (keys.has(key)) duplicates.push({ key: entry.key, sourcePath: entry.sourcePath });
      else {
        keys.add(key);
        entries.push(entry);
      }
    }
  }
  return { entries, duplicates };
}

export function projectResourceAbsolutePath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function inlineCodeRanges(line: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (let start = line.indexOf("`"); start >= 0;) {
    const end = line.indexOf("`", start + 1);
    if (end < 0) break;
    ranges.push([start, end + 1]);
    start = line.indexOf("`", end + 1);
  }
  return ranges;
}

export function findCitationGroups(markdown: string): CitationGroup[] {
  const groups: CitationGroup[] = [];
  let offset = 0;
  let fence: string | null = null;
  const lines = markdown.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      fence = fence ? null : fenceMatch[1][0];
      offset += line.length + 1;
      continue;
    }
    if (fence) {
      offset += line.length + 1;
      continue;
    }
    const code = inlineCodeRanges(line);
    const groupPattern = /\[[^\]\r\n]*@[^\]\r\n]*\]/g;
    for (let groupMatch = groupPattern.exec(line); groupMatch; groupMatch = groupPattern.exec(line)) {
      const localFrom = groupMatch.index;
      const localTo = localFrom + groupMatch[0].length;
      if (code.some(([from, to]) => localFrom >= from && localTo <= to)) continue;
      const items: CitationItem[] = [];
      const itemPattern = /(-?)@([A-Za-z0-9][\w:.#$%&+?<>~/.-]*)/g;
      for (let itemMatch = itemPattern.exec(groupMatch[0]); itemMatch; itemMatch = itemPattern.exec(groupMatch[0])) {
        const from = offset + localFrom + itemMatch.index;
        items.push({
          key: itemMatch[2],
          suppressAuthor: itemMatch[1] === "-",
          from,
          to: from + itemMatch[0].length,
          line: lineIndex + 1,
        });
      }
      if (items.length) groups.push({ from: offset + localFrom, to: offset + localTo, line: lineIndex + 1, items });
    }
    offset += line.length + 1;
  }
  return groups;
}

function authors(entry: CitationEntry): string[] {
  return (entry.fields.author ?? "").split(/\s+and\s+/i).map((author) => author.trim()).filter(Boolean);
}

function familyName(author: string): string {
  if (author.includes(",")) return author.split(",", 1)[0].trim();
  const parts = author.split(/\s+/);
  return parts[parts.length - 1] ?? author;
}

export function citationLabel(entry: CitationEntry): string {
  const names = authors(entry).map(familyName);
  const author = names.length > 2 ? `${names[0]} et al.` : names.join(" & ");
  const year = entry.fields.year?.trim();
  return [author || entry.fields.title || entry.key, year].filter(Boolean).join(", ");
}

export function referenceText(entry: CitationEntry): string {
  const author = entry.fields.author?.trim();
  const year = entry.fields.year?.trim();
  const title = entry.fields.title?.trim();
  return `${author || entry.key}${year ? ` (${year})` : ""}${title ? `. ${title}` : ""}.`;
}

export function citationReferenceId(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9_-]/g, (character) => `-${character.charCodeAt(0).toString(16)}-`);
  return `rune-reference-${safe || "entry"}`;
}

export function renderCitationMarkdown(
  markdown: string,
  entries: CitationEntry[],
): { markdown: string; cited: CitationEntry[] } {
  const byKey = new Map(entries.map((entry) => [entry.key.toLocaleLowerCase(), entry]));
  const groups = findCitationGroups(markdown);
  const cited: CitationEntry[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const entry = byKey.get(item.key.toLocaleLowerCase());
      const key = entry?.key.toLocaleLowerCase();
      if (entry && key && !seen.has(key)) {
        seen.add(key);
        cited.push(entry);
      }
    }
  }
  let rendered = markdown;
  for (const group of [...groups].reverse()) {
    // ponytail: standard single-line groups only; use a CSL processor when locator-perfect rendering is required.
    const items = group.items.map((item) => {
      const entry = byKey.get(item.key.toLocaleLowerCase());
      if (!entry) return `[@${item.key}]`;
      const label = item.suppressAuthor ? entry.fields.year || citationLabel(entry) : citationLabel(entry);
      return `[${label}](#${citationReferenceId(entry.key)})`;
    });
    rendered = `${rendered.slice(0, group.from)}(${items.join("; ")})${rendered.slice(group.to)}`;
  }
  return { markdown: rendered, cited };
}
