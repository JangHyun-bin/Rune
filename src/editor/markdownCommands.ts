import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";

export interface TextRange {
  from: number;
  to: number;
}

export interface TextEditResult {
  text: string;
  range: TextRange;
}

type InlineMarker = "*" | "**";

export function toggleInlineMarker(
  text: string,
  range: TextRange,
  marker: InlineMarker,
): TextEditResult {
  const markerLength = marker.length;
  const beforeMarkerFrom = range.from - markerLength;
  const hasMarkers =
    beforeMarkerFrom >= 0 &&
    text.slice(beforeMarkerFrom, range.from) === marker &&
    text.slice(range.to, range.to + markerLength) === marker;

  if (hasMarkers) {
    return {
      text:
        text.slice(0, beforeMarkerFrom) +
        text.slice(range.from, range.to) +
        text.slice(range.to + markerLength),
      range: { from: beforeMarkerFrom, to: range.to - markerLength },
    };
  }

  return {
    text:
      text.slice(0, range.from) +
      marker +
      text.slice(range.from, range.to) +
      marker +
      text.slice(range.to),
    range: { from: range.from + markerLength, to: range.to + markerLength },
  };
}

export function indentSelectedLines(
  text: string,
  range: TextRange,
  unit = "  ",
): TextEditResult {
  const lineStarts = touchedLineStarts(text, range);
  let nextText = text;
  let nextFrom = range.from;
  let nextTo = range.to;
  const isEmpty = range.from === range.to;

  for (let i = lineStarts.length - 1; i >= 0; i -= 1) {
    const lineStart = lineStarts[i];
    nextText = nextText.slice(0, lineStart) + unit + nextText.slice(lineStart);
    if (lineStart <= range.from) nextFrom += unit.length;
    if (lineStart < range.to || (isEmpty && lineStart <= range.to)) nextTo += unit.length;
  }

  return { text: nextText, range: { from: nextFrom, to: nextTo } };
}

export function outdentSelectedLines(
  text: string,
  range: TextRange,
  unit = "  ",
): TextEditResult {
  const removals = touchedLineStarts(text, range)
    .map((lineStart) => ({ from: lineStart, to: lineStart + outdentWidth(text, lineStart, unit) }))
    .filter((removal) => removal.to > removal.from);
  let nextText = text;
  let nextFrom = range.from;
  let nextTo = range.to;

  for (let i = removals.length - 1; i >= 0; i -= 1) {
    const removal = removals[i];
    nextText = nextText.slice(0, removal.from) + nextText.slice(removal.to);
    nextFrom -= removedBefore(range.from, removal);
    nextTo -= removedBefore(range.to, removal);
  }

  return { text: nextText, range: { from: nextFrom, to: nextTo } };
}

export function markdownShortcutKeymap(): Extension {
  const bindings: KeyBinding[] = [
    { key: "Mod-b", run: inlineMarkerCommand("**"), preventDefault: true },
    { key: "Mod-i", run: inlineMarkerCommand("*"), preventDefault: true },
    { key: "Tab", run: lineEditCommand(indentSelectedLines), preventDefault: true },
    { key: "Shift-Tab", run: lineEditCommand(outdentSelectedLines), preventDefault: true },
  ];
  return keymap.of(bindings);
}

function inlineMarkerCommand(marker: InlineMarker): Command {
  return (view) => {
    const range = view.state.selection.main;
    if (range.empty) return false;
    return applyTextEdit(
      view,
      toggleInlineMarker(view.state.doc.toString(), { from: range.from, to: range.to }, marker),
    );
  };
}

function lineEditCommand(
  edit: (text: string, range: TextRange) => TextEditResult,
): Command {
  return (view) => {
    const range = view.state.selection.main;
    return applyTextEdit(view, edit(view.state.doc.toString(), { from: range.from, to: range.to }));
  };
}

function applyTextEdit(view: EditorView, edit: TextEditResult): boolean {
  const currentText = view.state.doc.toString();
  const change = textChange(currentText, edit.text);
  view.dispatch({
    changes: change,
    selection: EditorSelection.single(edit.range.from, edit.range.to),
    scrollIntoView: true,
  });
  return true;
}

function textChange(before: string, after: string): { from: number; to: number; insert: string } {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1;

  let beforeTo = before.length;
  let afterTo = after.length;
  while (beforeTo > from && afterTo > from && before[beforeTo - 1] === after[afterTo - 1]) {
    beforeTo -= 1;
    afterTo -= 1;
  }

  return { from, to: beforeTo, insert: after.slice(from, afterTo) };
}

function touchedLineStarts(text: string, range: TextRange): number[] {
  const start = clamp(range.from, 0, text.length);
  const end = clamp(range.to, 0, text.length);
  const firstLineStart = lineStartAt(text, start);
  const endProbe = end > start ? end - 1 : start;
  const lastLineStart = lineStartAt(text, endProbe);
  const starts: number[] = [];
  let lineStart = firstLineStart;

  while (lineStart <= lastLineStart) {
    starts.push(lineStart);
    const nextBreak = text.indexOf("\n", lineStart);
    if (nextBreak === -1) break;
    lineStart = nextBreak + 1;
  }

  return starts;
}

function lineStartAt(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function outdentWidth(text: string, lineStart: number, unit: string): number {
  if (text.slice(lineStart, lineStart + unit.length) === unit) return unit.length;

  let width = 0;
  while (width < unit.length && text[lineStart + width] === " ") width += 1;
  return width;
}

function removedBefore(position: number, removal: TextRange): number {
  if (removal.to <= position) return removal.to - removal.from;
  if (removal.from < position) return position - removal.from;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
