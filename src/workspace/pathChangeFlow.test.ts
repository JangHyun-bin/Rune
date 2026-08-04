import { describe, expect, it, vi } from "vitest";
import type { PathChangePlan } from "../ipc/bindings";
import { runPathChange } from "./pathChangeFlow";

const plan: PathChangePlan = {
  planId: "plan-1",
  source: "C:\\vault\\old.md",
  destination: "C:\\vault\\new.md",
  canApply: true,
  pathChanges: [{ from: "C:\\vault\\old.md", to: "C:\\vault\\new.md" }],
  edits: [{
    path: "C:\\vault\\links.md",
    resultingPath: "C:\\vault\\links.md",
    replacements: [{ line: 2, oldHref: "old.md", newHref: "new.md", byteStart: 8, byteEnd: 14 }],
  }],
  issues: [],
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    plan: vi.fn(async () => ({ status: "ok" as const, data: plan })),
    apply: vi.fn(async () => ({ status: "ok" as const, data: { documents: 2, bytes: 20 } })),
    dirtyPaths: vi.fn(() => [] as string[]),
    preview: vi.fn(async () => true),
    synchronize: vi.fn(async () => {}),
    showError: vi.fn(),
    dirtyMessage: "dirty affected document",
    ...overrides,
  };
}

describe("runPathChange", () => {
  it("shows a plan error without opening preview", async () => {
    const deps = dependencies({ plan: vi.fn(async () => ({ status: "error" as const, error: "bad plan" })) });
    expect(await runPathChange("root", "old", "new", deps)).toBe("error");
    expect(deps.preview).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith("bad plan");
  });

  it("blocks when an affected document has a dirty editor buffer", async () => {
    const deps = dependencies({ dirtyPaths: vi.fn(() => ["C:\\vault\\links.md"]) });
    expect(await runPathChange("root", "old", "new", deps)).toBe("blocked");
    expect(deps.preview).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("leaves the workspace untouched when preview is canceled", async () => {
    const deps = dependencies({ preview: vi.fn(async () => false) });
    expect(await runPathChange("root", "old", "new", deps)).toBe("canceled");
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.synchronize).not.toHaveBeenCalled();
  });

  it("applies the confirmed plan id and synchronizes post-state", async () => {
    const deps = dependencies();
    expect(await runPathChange("root", "old", "new", deps)).toBe("applied");
    expect(deps.apply).toHaveBeenCalledWith("root", "old", "new", "plan-1");
    expect(deps.synchronize).toHaveBeenCalledWith(plan);
  });

  it("does not synchronize when apply rejects a stale plan", async () => {
    const deps = dependencies({ apply: vi.fn(async () => ({ status: "error" as const, error: "stale path change plan" })) });
    expect(await runPathChange("root", "old", "new", deps)).toBe("error");
    expect(deps.showError).toHaveBeenCalledWith("stale path change plan");
    expect(deps.synchronize).not.toHaveBeenCalled();
  });
});
