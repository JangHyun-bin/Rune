import { describe, expect, it } from "vitest";
import { detectSlashTrigger, slashCommands } from "./slashCommands";

describe("detectSlashTrigger", () => {
  it("detects a slash command at the start of a line", () => {
    expect(detectSlashTrigger("/ta", 3)).toEqual({ from: 0, to: 3, query: "ta" });
  });

  it("detects a slash command after leading spaces", () => {
    expect(detectSlashTrigger("  /code", 7)).toEqual({ from: 2, to: 7, query: "code" });
  });

  it("does not trigger in the middle of normal text", () => {
    expect(detectSlashTrigger("hello /ta", 9)).toBeNull();
  });
});

describe("slashCommands", () => {
  it("includes table, code, mermaid, todo, and callout snippets", () => {
    expect(slashCommands.map((command) => command.id)).toEqual(["table", "code", "mermaid", "todo", "callout"]);
  });
});
