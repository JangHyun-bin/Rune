import { describe, it, expect } from "vitest";
import { countWords } from "./wordcount";

describe("countWords", () => {
  it("empty string is 0", () => expect(countWords("")).toBe(0));
  it("whitespace only is 0", () => expect(countWords("   \n\t ")).toBe(0));
  it("counts space-separated words", () => expect(countWords("hello world")).toBe(2));
  it("collapses multiple spaces/newlines", () => expect(countWords("a   b\n\nc")).toBe(3));
  it("counts CJK runs as words too", () => expect(countWords("안녕 세계")).toBe(2));
});
