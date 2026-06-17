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

function nonEmptyRows(source: string): Array<{ text: string; sourceLine: number }> {
  return source.split("\n")
    .map((text, sourceLine) => ({ text, sourceLine }))
    .filter((line) => line.text.trim() !== "");
}

function lineStartOffset(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1;
  return offset;
}

function cellBoundsInLine(line: string, columnIndex: number): { from: number; to: number } | null {
  if (columnIndex < 0) return null;
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|") pipes.push(i);
  }

  const hasLeadingPipe = pipes.length > 0 && line.slice(0, pipes[0]).trim() === "";
  const from = hasLeadingPipe
    ? pipes[columnIndex] + 1
    : columnIndex === 0 ? 0 : pipes[columnIndex - 1] + 1;
  const to = hasLeadingPipe
    ? pipes[columnIndex + 1] ?? line.length
    : pipes[columnIndex] ?? line.length;

  if (!Number.isFinite(from) || from > line.length || to < from) return null;
  return { from, to };
}

export function tableCellEditOffset(source: string, sourceLine: number, columnIndex: number): number | null {
  const lines = source.split("\n");
  const line = lines[sourceLine];
  if (line === undefined) return null;
  const bounds = cellBoundsInLine(line, columnIndex);
  if (!bounds) return null;

  const cell = line.slice(bounds.from, bounds.to);
  const firstText = cell.search(/\S/);
  const offsetInLine = firstText >= 0
    ? bounds.from + firstText
    : Math.min(bounds.to, bounds.from + 1);
  return lineStartOffset(lines, sourceLine) + offsetInLine;
}

function tableEditOffset(source: string, target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>("[data-rune-table-line][data-rune-table-column]");
  if (!cell) return null;
  const sourceLine = Number(cell.dataset.runeTableLine);
  const column = Number(cell.dataset.runeTableColumn);
  if (!Number.isInteger(sourceLine) || !Number.isInteger(column)) return null;
  return tableCellEditOffset(source, sourceLine, column);
}

function renderTable(source: string): HTMLElement {
  const rows = nonEmptyRows(source);
  const aligns = rows.length >= 2 ? parseAlignments(rows[1].text) : [];
  const table = document.createElement("table");
  table.className = "cm-md-table";
  if (rows.length >= 1) {
    const thead = table.createTHead();
    const hr = thead.insertRow();
    splitRow(rows[0].text).forEach((c, i) => {
      const th = document.createElement("th");
      th.textContent = c;
      th.dataset.runeTableLine = String(rows[0].sourceLine);
      th.dataset.runeTableColumn = String(i);
      if (aligns[i]) th.style.textAlign = aligns[i]!;
      hr.appendChild(th);
    });
  }
  const body = table.createTBody();
  for (let i = 2; i < rows.length; i++) { // 0 = header, 1 = delimiter row
    const row = body.insertRow();
    splitRow(rows[i].text).forEach((c, j) => {
      const td = row.insertCell();
      td.textContent = c;
      td.dataset.runeTableLine = String(rows[i].sourceLine);
      td.dataset.runeTableColumn = String(j);
      if (aligns[j]) td.style.textAlign = aligns[j]!;
    });
  }
  return table;
}

export const tableSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "Table",
  key: (source: string) => "table:" + source,
  render: (source: string) => renderTable(source),
  editOffset: tableEditOffset,
};
