import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type RangeLike = { from: number; to: number };

const observers = new WeakMap<HTMLElement, ResizeObserver>();

export function selectionIntersectsSourceRange(ranges: readonly RangeLike[], from: number, to: number): boolean {
  for (const range of ranges) {
    if (range.from === range.to) {
      if (range.from > from && range.from < to) return true;
    } else if (range.from < to && range.to > from) {
      return true;
    }
  }
  return false;
}

export function selectionInsideSource(state: EditorState, from: number, to: number): boolean {
  return selectionIntersectsSourceRange(state.selection.ranges, from, to);
}

export function preventPreviewWidgetEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export function previewWidgetEditAnchor(from: number, to: number, relativeOffset = 1): number {
  if (to - from <= 1) return from;
  const offset = Math.max(1, Math.min(relativeOffset, to - from - 1));
  return from + offset;
}

export function editPreviewWidgetSource(
  view: EditorView,
  from: number,
  to: number,
  relativeOffset = 1,
): void {
  const anchor = previewWidgetEditAnchor(from, to, relativeOffset);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  view.focus();
}

export function bindPreviewWidgetEdit(
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
  getRelativeOffset?: (event: PointerEvent) => number | null | undefined,
): void {
  element.addEventListener("pointerdown", (event) => {
    preventPreviewWidgetEvent(event);
    editPreviewWidgetSource(view, from, to, getRelativeOffset?.(event) ?? 1);
  });
}

export function makePreviewWidgetInert(element: HTMLElement): HTMLElement {
  element.contentEditable = "false";
  element.draggable = false;
  element.setAttribute("data-rune-preview-widget", "true");

  element.addEventListener("pointerdown", preventPreviewWidgetEvent);
  element.addEventListener("mousedown", preventPreviewWidgetEvent);
  element.addEventListener("dragstart", preventPreviewWidgetEvent);
  element.addEventListener("selectstart", preventPreviewWidgetEvent);
  return element;
}

export function watchPreviewWidgetSize(element: HTMLElement, view: EditorView): void {
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => view.requestMeasure());
  observer.observe(element);
  observers.set(element, observer);
}

export function unwatchPreviewWidgetSize(element: HTMLElement): void {
  observers.get(element)?.disconnect();
  observers.delete(element);
}
