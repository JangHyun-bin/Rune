import { describe, it, expect } from "vitest";
import { newDoc, loadedDoc, withCurrentText, markSaved, isDirty } from "./document";

describe("document model", () => {
  it("new doc is not dirty", () => {
    expect(isDirty(newDoc())).toBe(false);
  });
  it("editing makes it dirty", () => {
    const d = withCurrentText(loadedDoc("/a.md", "x"), "xy");
    expect(isDirty(d)).toBe(true);
  });
  it("saving clears dirty and updates savedText", () => {
    const d = markSaved(withCurrentText(loadedDoc("/a.md", "x"), "xy"));
    expect(isDirty(d)).toBe(false);
    expect(d.savedText).toBe("xy");
  });
  it("loadedDoc records path and is clean", () => {
    const d = loadedDoc("/a.md", "hello");
    expect(d.path).toBe("/a.md");
    expect(isDirty(d)).toBe(false);
  });
});
