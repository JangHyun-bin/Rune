import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "./commandRegistry";

describe("command registry", () => {
  it("executes a registered handler by stable command id", () => {
    const run = vi.fn();
    const registry = createCommandRegistry();
    registry.register({ id: "workbench.togglePanel", title: () => "Toggle Panel", run });

    registry.execute("workbench.togglePanel");

    expect(run).toHaveBeenCalledTimes(1);
    expect(registry.commands().map(({ id }) => id)).toEqual(["workbench.togglePanel"]);
  });

  it("rejects duplicate and unknown command ids", () => {
    const registry = createCommandRegistry();
    registry.register({ id: "workbench.togglePanel", title: () => "Toggle Panel", run() {} });

    expect(() => registry.register({ id: "workbench.togglePanel", title: () => "Other", run() {} }))
      .toThrow("Duplicate command: workbench.togglePanel");
    expect(() => registry.execute("workbench.missing")).toThrow("Unknown command: workbench.missing");
  });

  it("removes scoped registrations and rejects use after disposal", () => {
    const registry = createCommandRegistry();
    const unregister = registry.register({ id: "workbench.togglePanel", title: () => "Toggle Panel", run() {} });

    unregister();
    expect(registry.commands()).toEqual([]);

    registry.dispose();
    expect(() => registry.register({ id: "workbench.togglePanel", title: () => "Toggle Panel", run() {} }))
      .toThrow("Command registry is disposed");
    expect(() => registry.execute("workbench.togglePanel")).toThrow("Command registry is disposed");
  });
});
