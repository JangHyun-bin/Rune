import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { focusedParagraphLines } from "./writingModes";

describe("focused paragraph", () => {
  it("uses blank lines as paragraph boundaries", () => {
    const doc = Text.of(["first", "continues", "", "second", "continues", "", "third"]);

    expect(focusedParagraphLines(doc, doc.line(4).from + 2)).toEqual({ fromLine: 4, toLine: 5 });
  });

  it("focuses a blank cursor line by itself", () => {
    const doc = Text.of(["first", "", "second"]);

    expect(focusedParagraphLines(doc, doc.line(2).from)).toEqual({ fromLine: 2, toLine: 2 });
  });

  it("includes the final paragraph at the end of the document", () => {
    const doc = Text.of(["first", "", "끝", "문단"]);

    expect(focusedParagraphLines(doc, doc.length)).toEqual({ fromLine: 3, toLine: 4 });
  });
});
