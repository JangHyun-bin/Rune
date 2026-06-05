import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|?/, "").replace(/\|?\s*$/, "").split("|").map((c) => c.trim());
}

export type ColAlign = "left" | "center" | "right" | null;

/** Parse a GFM delimiter row (e.g. "| :--- | :---: | ---: |") into per-column alignment. */
export function parseAlignments(delimiter: string): ColAlign[] {
  return splitRow(delimiter).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function renderTable(source: string): HTMLElement {
  const lines = source.split("\n").filter((l) => l.trim() !== "");
  const aligns = lines.length >= 2 ? parseAlignments(lines[1]) : [];
  const table = document.createElement("table");
  table.className = "cm-md-table";
  if (lines.length >= 1) {
    const thead = table.createTHead();
    const hr = thead.insertRow();
    splitRow(lines[0]).forEach((c, i) => {
      const th = document.createElement("th");
      th.textContent = c;
      if (aligns[i]) th.style.textAlign = aligns[i]!;
      hr.appendChild(th);
    });
  }
  const body = table.createTBody();
  for (let i = 2; i < lines.length; i++) { // 0 = header, 1 = delimiter row
    const row = body.insertRow();
    splitRow(lines[i]).forEach((c, j) => {
      const td = row.insertCell();
      td.textContent = c;
      if (aligns[j]) td.style.textAlign = aligns[j]!;
    });
  }
  return table;
}

export const tableSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "Table",
  key: (source: string) => "table:" + source,
  render: (source: string) => renderTable(source),
};
