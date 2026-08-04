import { describe, expect, it } from "vitest";
import type { PathChangePlan } from "../ipc/bindings";
import { setLocale } from "../i18n/i18n";
import { pathChangePreviewModel } from "./pathChangePreview";

function plan(overrides: Partial<PathChangePlan> = {}): PathChangePlan {
  return {
    planId: "p1",
    source: "/vault/old.md",
    destination: "/vault/new.md",
    canApply: true,
    pathChanges: [{ from: "/vault/old.md", to: "/vault/new.md" }],
    edits: [{
      path: "/vault/links.md",
      resultingPath: "/vault/links.md",
      replacements: [{ line: 4, oldHref: "old.md", newHref: "new.md", byteStart: 10, byteEnd: 16 }],
    }],
    issues: [],
    ...overrides,
  };
}

describe("pathChangePreviewModel", () => {
  it("exposes source, destination, affected documents and exact replacements", () => {
    const model = pathChangePreviewModel(plan());
    expect(model.source).toBe("/vault/old.md");
    expect(model.destination).toBe("/vault/new.md");
    expect(model.movedPaths).toEqual([{
      from: "/vault/old.md",
      to: "/vault/new.md",
    }]);
    expect(model.documents).toEqual([{
      path: "/vault/links.md",
      resultingPath: "/vault/links.md",
      replacements: [{ line: 4, before: "old.md", after: "new.md" }],
    }]);
    expect(model.confirmEnabled).toBe(true);
  });

  it("exposes blocking and nonblocking issues and disables confirmation", () => {
    setLocale("en");
    const model = pathChangePreviewModel(plan({
      canApply: false,
      issues: [
        { kind: "destinationExists", path: "/vault/new.md", href: null, blocking: true },
        { kind: "unresolvedLink", path: "/vault/old.md", href: "missing.md", blocking: false },
      ],
    }));
    expect(model.confirmEnabled).toBe(false);
    expect(model.issues).toHaveLength(2);
    expect(model.issues[0].blocking).toBe(true);
    expect(model.issues.map((issue) => issue.label)).toEqual([
      "Destination already exists",
      "Unresolved local link",
    ]);
  });
});
