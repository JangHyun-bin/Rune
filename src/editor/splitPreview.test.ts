import { describe, expect, it } from "vitest";
import { scrollRatio, scrollTopForRatio } from "./splitPreview";

describe("split preview scroll helpers", () => {
  it("returns zero when the source cannot scroll", () => {
    expect(scrollRatio({ scrollTop: 120, scrollHeight: 500, clientHeight: 500 })).toBe(0);
    expect(scrollTopForRatio({ scrollHeight: 500, clientHeight: 500 }, 0.75)).toBe(0);
  });

  it("maps scroll positions by scrollable ratio", () => {
    expect(scrollRatio({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 })).toBe(0.5);
    expect(scrollTopForRatio({ scrollHeight: 700, clientHeight: 300 }, 0.5)).toBe(200);
  });

  it("clamps ratios to the scrollable range", () => {
    expect(scrollRatio({ scrollTop: -100, scrollHeight: 1000, clientHeight: 500 })).toBe(0);
    expect(scrollRatio({ scrollTop: 900, scrollHeight: 1000, clientHeight: 500 })).toBe(1);
    expect(scrollTopForRatio({ scrollHeight: 900, clientHeight: 300 }, -1)).toBe(0);
    expect(scrollTopForRatio({ scrollHeight: 900, clientHeight: 300 }, 2)).toBe(600);
  });
});
