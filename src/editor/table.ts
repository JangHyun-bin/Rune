import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|?/, "").replace(/\|?\s*$/, "").split("|").map((c) => c.trim());
}

function renderTable(source: string): HTMLElement {
  const lines = source.split("\n").filter((l) => l.trim() !== "");
  const table = document.createElement("table");
  table.className = "cm-md-table";
  if (lines.length >= 1) {
    const thead = table.createTHead();
    const hr = thead.insertRow();
    for (const c of splitRow(lines[0])) {
      const th = document.createElement("th");
      th.textContent = c;
      hr.appendChild(th);
    }
  }
  const body = table.createTBody();
  for (let i = 2; i < lines.length; i++) { // 0 = header, 1 = delimiter row
    const row = body.insertRow();
    for (const c of splitRow(lines[i])) {
      const td = row.insertCell();
      td.textContent = c;
    }
  }
  return table;
}

export const tableSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "Table",
  key: (source: string) => "table:" + source,
  render: (source: string) => renderTable(source),
};
