import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** 라이트/다크 모두에서 읽히는 절제된 코드 하이라이트. */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#a855c7" },
  { tag: [t.string, t.special(t.string)], color: "#3a9e6e" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8a909c", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#d2843a" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#4f6bed" },
  { tag: [t.typeName, t.className, t.namespace], color: "#c08a2e" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#8a909c" },
  { tag: [t.propertyName, t.attributeName], color: "#4f6bed" },
  { tag: t.variableName, color: "var(--text)" },
]);
