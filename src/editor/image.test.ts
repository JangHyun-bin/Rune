import { describe, expect, it, vi } from "vitest";
import { docDirFromPath, isImageResolvable, resolveImageSrc } from "./image";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("image preview path resolution", () => {
  it("derives a document directory from slash or backslash paths", () => {
    expect(docDirFromPath("C:\\work\\note.md")).toBe("C:\\work");
    expect(docDirFromPath("/work/note.md")).toBe("/work");
    expect(docDirFromPath("note.md")).toBeNull();
  });

  it("resolves relative image URLs with the supplied document path", () => {
    const src = resolveImageSrc("assets/pic.png", {
      getDocPath: () => "C:\\work\\notes\\note.md",
    });

    expect(src).toBe("asset://C:\\work\\notes\\assets\\pic.png");
    expect(isImageResolvable("assets/pic.png", { getDocPath: () => "C:\\work\\notes\\note.md" })).toBe(true);
  });

  it("leaves relative image URLs unresolved without document context", () => {
    expect(resolveImageSrc("assets/pic.png", { getDocPath: () => null })).toBe("assets/pic.png");
    expect(isImageResolvable("assets/pic.png", { getDocPath: () => null })).toBe(false);
  });
});
