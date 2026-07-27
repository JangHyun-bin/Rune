import { describe, expect, it, vi } from "vitest";
import { createViewRegistry } from "./viewRegistry";

describe("view registry", () => {
  it("creates a registered view once and returns the same instance", () => {
    const create = vi.fn(() => ({
      element: {} as HTMLElement,
      dispose: vi.fn(),
    }));
    const registry = createViewRegistry();
    registry.registerView({
      id: "outline",
      titleKey: "outline.title",
      defaultContainerId: "explorer",
      order: 1,
      create,
    });

    expect(registry.resolveView("outline")).toBe(registry.resolveView("outline"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate ids", () => {
    const registry = createViewRegistry();
    registry.registerContainer({ id: "explorer", titleKey: "view.explorer", icon: "files", order: 0 });

    expect(() => registry.registerContainer({
      id: "explorer",
      titleKey: "view.explorer",
      icon: "files",
      order: 0,
    })).toThrow("Duplicate view container: explorer");
  });

  it("disposes every created view exactly once", () => {
    const dispose = vi.fn();
    const registry = createViewRegistry();
    registry.registerView({
      id: "outline",
      titleKey: "outline.title",
      defaultContainerId: "explorer",
      order: 1,
      create: () => ({ element: {} as HTMLElement, dispose }),
    });

    registry.resolveView("outline");
    registry.dispose();
    registry.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("sorts contributions by order then id", () => {
    const registry = createViewRegistry();
    registry.registerContainer({ id: "search", titleKey: "search", icon: "search", order: 0 });
    registry.registerContainer({ id: "explorer", titleKey: "explorer", icon: "files", order: 0 });
    registry.registerView({ id: "search", titleKey: "search", defaultContainerId: "explorer", order: 0, create: () => ({ element: {} as HTMLElement, dispose() {} }) });
    registry.registerView({ id: "outline", titleKey: "outline", defaultContainerId: "explorer", order: 0, create: () => ({ element: {} as HTMLElement, dispose() {} }) });

    expect(registry.containers().map(({ id }) => id)).toEqual(["explorer", "search"]);
    expect(registry.views("explorer").map(({ id }) => id)).toEqual(["outline", "search"]);
  });

  it("rejects an unknown view", () => {
    expect(() => createViewRegistry().view("outline")).toThrow("Unknown view: outline");
  });

  it("relabels created views only", () => {
    const relabel = vi.fn();
    const registry = createViewRegistry();
    registry.registerView({ id: "outline", titleKey: "outline", defaultContainerId: "explorer", order: 0, create: () => ({ element: {} as HTMLElement, relabel, dispose() {} }) });
    registry.relabel();
    registry.resolveView("outline");
    registry.relabel();

    expect(relabel).toHaveBeenCalledTimes(1);
  });
});
