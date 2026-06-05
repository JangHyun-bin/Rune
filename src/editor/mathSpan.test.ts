import { describe, it, expect } from "vitest";
import { isInlineMath } from "./mathSpan";

describe("isInlineMath", () => {
  it("accepts real inline math content", () => {
    expect(isInlineMath("E=mc^2")).toBe(true);
    expect(isInlineMath("x")).toBe(true);
  });
  it("rejects content starting with a digit (currency like $5)", () => {
    expect(isInlineMath("5 and ")).toBe(false);
    expect(isInlineMath("20, sale ")).toBe(false);
  });
  it("rejects content starting or ending with whitespace", () => {
    expect(isInlineMath(" x")).toBe(false);
    expect(isInlineMath("x ")).toBe(false);
  });
  it("rejects empty content", () => {
    expect(isInlineMath("")).toBe(false);
  });
});
