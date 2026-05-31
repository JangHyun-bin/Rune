import { describe, it, expect } from "vitest";
import { newDoc, loadedDoc, withCurrentText, markSaved, isDirty, markSavedAs } from "./document";

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
  it("markSavedAs records the snapshot text and path, clearing dirty", () => {
    const d = withCurrentText(loadedDoc("/a.md", "x"), "edited");
    const saved = markSavedAs(d, "/a.md", "edited");
    expect(saved.path).toBe("/a.md");
    expect(saved.savedText).toBe("edited");
    expect(isDirty(saved)).toBe(false);
  });
});
