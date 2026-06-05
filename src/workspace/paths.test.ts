import { describe, it, expect } from "vitest";
import { parentDir } from "./paths";

describe("parentDir", () => {
  it("returns the POSIX parent", () => {
    expect(parentDir("/home/u/notes/a.md")).toBe("/home/u/notes");
  });
  it("returns the Windows parent", () => {
    expect(parentDir("C:\\Users\\u\\notes\\a.md")).toBe("C:\\Users\\u\\notes");
  });
  it("returns null when there is no separator", () => {
    expect(parentDir("a.md")).toBe(null);
  });
  it("returns null at a root-level child", () => {
    expect(parentDir("/a.md")).toBe(null);
  });
});
