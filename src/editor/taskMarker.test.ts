import { describe, it, expect } from "vitest";
import { toggledTaskMarker } from "./taskMarker";

describe("toggledTaskMarker", () => {
  it("unchecks a checked marker", () => {
    expect(toggledTaskMarker("[x]")).toBe("[ ]");
    expect(toggledTaskMarker("[X]")).toBe("[ ]");
  });
  it("checks an unchecked marker", () => {
    expect(toggledTaskMarker("[ ]")).toBe("[x]");
  });
});
