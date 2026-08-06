import type { CompletionContext, CompletionSource } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { citationLabel, findCitationGroups, type CitationEntry } from "../project/citations";

export interface CitationCompletion {
  label: string;
  detail: string;
}

export interface CitationCompletionResult {
  from: number;
  options: CitationCompletion[];
}

export interface CitationDiagnostic {
  from: number;
  to: number;
  key: string;
}

export function citationCompletions(
  markdown: string,
  position: number,
  entries: CitationEntry[],
): CitationCompletionResult | null {
  if (markdown.slice(position).startsWith("]")) return null;
  const lineStart = markdown.lastIndexOf("\n", position - 1) + 1;
  const before = markdown.slice(lineStart, position);
  const bracket = before.lastIndexOf("[");
  if (bracket < 0 || before.lastIndexOf("]") > bracket) return null;
  const match = before.slice(bracket + 1).match(/(?:^|[\s;,(])(?:-)?@([\w:.#$%&+?<>~/.-]*)$/);
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  const options = entries.flatMap((entry) => {
    const key = entry.key.toLocaleLowerCase();
    const searchable = `${entry.fields.author ?? ""} ${entry.fields.title ?? ""} ${entry.fields.year ?? ""}`.toLocaleLowerCase();
    const rank = key.startsWith(query) ? 0 : key.includes(query) || searchable.includes(query) ? 1 : -1;
    return rank < 0 ? [] : [{
      rank,
      label: entry.key,
      detail: `${citationLabel(entry)}${entry.fields.title ? ` · ${entry.fields.title}` : ""}`,
    }];
  }).sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
  return { from: position - match[1].length, options: options.map(({ label, detail }) => ({ label, detail })) };
}

export function citationDiagnostics(markdown: string, entries: CitationEntry[]): CitationDiagnostic[] {
  const keys = new Set(entries.map((entry) => entry.key.toLocaleLowerCase()));
  return findCitationGroups(markdown).flatMap((group) => group.items.flatMap((item) =>
    keys.has(item.key.toLocaleLowerCase()) ? [] : [{
      from: item.to - item.key.length,
      to: item.to,
      key: item.key,
    }],
  ));
}

export function citationCompletionSource(getEntries: () => CitationEntry[]): CompletionSource {
  return (context: CompletionContext) => {
    const result = citationCompletions(context.state.doc.toString(), context.pos, getEntries());
    return result ? {
      from: result.from,
      options: result.options.map((option) => ({ ...option, type: "reference" })),
    } : null;
  };
}

export function citationLintExtension(
  getEntries: () => CitationEntry[],
  message: (key: string) => string,
): Extension {
  return linter((view): Diagnostic[] => citationDiagnostics(view.state.doc.toString(), getEntries()).map((diagnostic) => ({
    ...diagnostic,
    severity: "warning",
    message: message(diagnostic.key),
  })));
}
