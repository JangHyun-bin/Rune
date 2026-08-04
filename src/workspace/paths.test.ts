import { describe, it, expect } from "vitest";
import { parentDir, samePath } from "./paths";

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
  it("returns null at a Windows drive-root child", () => {
    expect(parentDir("C:\\a.md")).toBe(null);
    expect(parentDir("C:/a.md")).toBe(null);
  });
});

describe("samePath", () => {
  it("normalizes separators and case for absolute Windows paths", () => {
    expect(samePath("C:\\Vault\\Note.md", "c:/vault/note.md")).toBe(true);
  });

  it("preserves case and backslashes for POSIX paths", () => {
    expect(samePath("/vault/Note.md", "/vault/note.md")).toBe(false);
    expect(samePath("/vault/a\\b.md", "/vault/a/b.md")).toBe(false);
  });
});
