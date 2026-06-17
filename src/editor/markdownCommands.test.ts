import { describe, expect, it } from "vitest";
import {
  indentSelectedLines,
  outdentSelectedLines,
  toggleInlineMarker,
} from "./markdownCommands";

describe("markdown editing commands", () => {
  it("wraps an italic marker around the selection", () => {
    expect(toggleInlineMarker("hello world", { from: 0, to: 5 }, "*")).toEqual({
      text: "*hello* world",
      range: { from: 1, to: 6 },
    });
  });

  it("wraps an italic marker inside bold markers", () => {
    expect(toggleInlineMarker("**hello**", { from: 2, to: 7 }, "*")).toEqual({
      text: "***hello***",
      range: { from: 3, to: 8 },
    });
  });

  it("unwraps an italic marker around the selection", () => {
    expect(toggleInlineMarker("*hello* world", { from: 1, to: 6 }, "*")).toEqual({
      text: "hello world",
      range: { from: 0, to: 5 },
    });
  });

  it("unwraps an italic marker while preserving bold markers", () => {
    expect(toggleInlineMarker("***hello***", { from: 3, to: 8 }, "*")).toEqual({
      text: "**hello**",
      range: { from: 2, to: 7 },
    });
  });

  it("wraps a bold marker around the selection", () => {
    expect(toggleInlineMarker("hello", { from: 0, to: 5 }, "**")).toEqual({
      text: "**hello**",
      range: { from: 2, to: 7 },
    });
  });

  it("indents selected lines", () => {
    expect(indentSelectedLines("one\ntwo\nthree", { from: 4, to: 7 })).toEqual({
      text: "one\n  two\nthree",
      range: { from: 6, to: 9 },
    });
  });

  it("outdents selected lines", () => {
    expect(outdentSelectedLines("one\n  two\n  three", { from: 6, to: 15 })).toEqual({
      text: "one\ntwo\nthree",
      range: { from: 4, to: 11 },
    });
  });

  it("outdents a leading tab as one indentation unit", () => {
    expect(outdentSelectedLines("\tone", { from: 1, to: 4 })).toEqual({
      text: "one",
      range: { from: 0, to: 3 },
    });
  });
});
