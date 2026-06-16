export interface SlashTrigger {
  from: number;
  to: number;
  query: string;
}

export interface SlashCommand {
  id: "table" | "code" | "mermaid" | "todo" | "callout";
  label: string;
  insert: string;
  cursorOffset: number;
}

export const slashCommands: SlashCommand[] = [
  { id: "table", label: "Table", insert: "| Column | Column |\n| --- | --- |\n|  |  |", cursorOffset: 36 },
  { id: "code", label: "Code block", insert: "```\n\n```", cursorOffset: 4 },
  { id: "mermaid", label: "Mermaid diagram", insert: "```mermaid\ngraph TD\n  A[Start] --> B[End]\n```", cursorOffset: 19 },
  { id: "todo", label: "Task list", insert: "- [ ] ", cursorOffset: 6 },
  { id: "callout", label: "Callout", insert: "> [!NOTE]\n> ", cursorOffset: 12 },
];

export function detectSlashTrigger(linePrefix: string, cursorOffset: number): SlashTrigger | null {
  const prefix = linePrefix.slice(0, cursorOffset);
  const match = prefix.match(/(^|\s)\/([A-Za-z]*)$/);
  if (!match) return null;

  const slashFrom = prefix.length - match[2].length - 1;
  const beforeSlash = prefix.slice(0, slashFrom);
  if (beforeSlash.trim().length > 0) return null;

  return { from: slashFrom, to: prefix.length, query: match[2].toLowerCase() };
}
