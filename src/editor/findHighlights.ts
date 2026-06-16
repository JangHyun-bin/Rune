import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { MatchRange } from "../workspace/findReplace";

export interface FindHighlightSpec extends MatchRange {
  className: string;
}

export interface FindHighlightPayload {
  matches: MatchRange[];
  activeIndex: number;
}

export const setFindHighlights = StateEffect.define<FindHighlightPayload>();
export const clearFindHighlights = StateEffect.define<void>();

export function findHighlightSpecs(matches: MatchRange[], activeIndex: number): FindHighlightSpec[] {
  return matches.map((match, index) => ({
    ...match,
    className: index === activeIndex ? "cm-find-match cm-find-match-active" : "cm-find-match",
  }));
}

function buildHighlights(payload: FindHighlightPayload): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const spec of findHighlightSpecs(payload.matches, payload.activeIndex)) {
    if (spec.to <= spec.from) continue;
    builder.add(spec.from, spec.to, Decoration.mark({ class: spec.className }));
  }
  return builder.finish();
}

const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = transaction.docChanged ? decorations.map(transaction.changes) : decorations;
    for (const effect of transaction.effects) {
      if (effect.is(setFindHighlights)) next = buildHighlights(effect.value);
      else if (effect.is(clearFindHighlights)) next = Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function findHighlightExtension(): Extension {
  return findHighlightField;
}
