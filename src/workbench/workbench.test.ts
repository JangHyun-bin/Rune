import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";
import { createViewRegistry } from "./viewRegistry";
import { mountWorkbench } from "./workbench";

type Listener = (event: Event) => void;

class TestElement {
  className = "";
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  parentElement: TestElement | null = null;
  style: Record<string, string> & { setProperty(name: string, value: string): void };
  tagName: string;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();
  private text = "";
  classList = {
    add: (...tokens: string[]) => {
      const current = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const token of tokens) current.add(token);
      this.className = [...current].join(" ");
    },
    remove: (...tokens: string[]) => {
      const removed = new Set(tokens);
      this.className = this.className.split(/\s+/).filter((token) => token && !removed.has(token)).join(" ");
    },
    contains: (token: string) => this.className.split(/\s+/).includes(token),
    toggle: (token: string, force?: boolean) => {
      const shouldAdd = force ?? !this.classList.contains(token);
      if (shouldAdd) this.classList.add(token);
      else this.classList.remove(token);
      return shouldAdd;
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
    this.style = Object.assign(Object.create(null), {
      setProperty: (name: string, value: string) => {
        this.style[name] = value;
      },
    });
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string | null) {
    this.text = value ?? "";
    this.replaceChildren();
  }

  appendChild(child: TestElement): TestElement {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: TestElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(candidate: TestElement | null): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  focus(): void {
    testDocument.activeElement = this;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, values: Record<string, unknown> = {}): void {
    const event = { type, preventDefault() {}, ...values } as unknown as Event;
    Object.defineProperty(event, "target", { value: this });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean { return true; }
}

class TestWindow {
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, values: Record<string, unknown> = {}): void {
    const event = { type, ...values } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const testDocument = {
  activeElement: null as TestElement | null,
  body: new TestElement("body"),
  createElement: (tagName: string) => new TestElement(tagName),
};
let testWindow: TestWindow;

function walk(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap(walk)];
}

function byClass(root: TestElement, className: string): TestElement[] {
  return walk(root).filter((element) => element.classList.contains(className));
}

function byData(root: TestElement, name: string, value: string): TestElement {
  const element = walk(root).find((candidate) => candidate.dataset[name] === value);
  if (!element) throw new Error(`Missing data-${name}="${value}"`);
  return element;
}

function viewById(root: TestElement, id: string): TestElement {
  const element = walk(root).find((candidate) =>
    candidate.classList.contains("workbench-view") && candidate.dataset.viewId === id);
  if (!element) throw new Error(`Missing workbench view "${id}"`);
  return element;
}

function setup() {
  const registry = createViewRegistry();
  const createWorkspace = vi.fn(() => ({ element: document.createElement("div"), dispose() {} }));
  const createOutline = vi.fn(() => ({ element: document.createElement("div"), dispose() {} }));
  const createSearch = vi.fn(() => ({ element: document.createElement("div"), dispose() {} }));
  registry.registerContainer({ id: "explorer", titleKey: "Explorer", icon: "files", order: 0 });
  registry.registerContainer({ id: "search", titleKey: "Search", icon: "search", order: 1 });
  registry.registerView({ id: "workspace", titleKey: "Workspace", defaultContainerId: "explorer", order: 0, create: createWorkspace });
  registry.registerView({ id: "outline", titleKey: "Outline", defaultContainerId: "explorer", order: 1, create: createOutline });
  registry.registerView({ id: "search", titleKey: "Search", defaultContainerId: "search", order: 0, create: createSearch });

  const hosts = {
    activityBar: document.createElement("nav"),
    primarySidebar: document.createElement("aside"),
    primaryResizer: document.createElement("div"),
    secondarySidebar: document.createElement("aside"),
    secondaryResizer: document.createElement("div"),
    panel: document.createElement("section"),
    panelResizer: document.createElement("div"),
  };
  const focusEditor = vi.fn();
  const onDidChange = vi.fn();
  const workbench = mountWorkbench({
    ...hosts,
    registry,
    initialState: DEFAULT_WORKBENCH_LAYOUT,
    focusEditor,
    onDidChange,
  });

  return {
    ...hosts,
    registry,
    workbench,
    focusEditor,
    onDidChange,
    createWorkspace,
    createOutline,
    createSearch,
  };
}

beforeEach(() => {
  testDocument.activeElement = null;
  testDocument.body = new TestElement("body");
  testWindow = new TestWindow();
  vi.stubGlobal("document", testDocument);
  vi.stubGlobal("window", testWindow);
});

describe("workbench", () => {
  it("mounts Workspace and Outline in Explorer order", () => {
    const { primarySidebar } = setup();
    const container = byData(primarySidebar as unknown as TestElement, "containerId", "explorer");
    const views = byClass(container, "workbench-view");

    expect(views.map((view) => view.dataset.viewId)).toEqual(["workspace", "outline"]);
  });

  it("closes and reopens Outline without recreating its element", () => {
    const { primarySidebar, workbench, createOutline } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const element = byClass(outline, "workbench-view-body")[0].children[0];

    workbench.closeView("outline");
    expect(outline.classList.contains("hidden")).toBe(true);
    expect(element.parentElement).not.toBeNull();
    byClass(primarySidebar as unknown as TestElement, "view-restore")[0].dispatch("click");
    workbench.closeView("outline");

    expect(createOutline).toHaveBeenCalledTimes(1);
    expect(byClass(viewById(primarySidebar as unknown as TestElement, "outline"), "workbench-view-body")[0].children[0]).toBe(element);
  });

  it("activates Search from the Activity Bar and mounts its view", () => {
    const { activityBar, primarySidebar, createSearch } = setup();

    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");

    expect(byData(primarySidebar as unknown as TestElement, "containerId", "search")).toBeDefined();
    expect(byData(primarySidebar as unknown as TestElement, "viewId", "search")).toBeDefined();
    expect(createSearch).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the editor when a focused Outline is closed", () => {
    const { primarySidebar, focusEditor } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const element = byClass(outline, "workbench-view-body")[0].children[0];
    element.focus();

    byClass(outline, "view-close")[0].dispatch("click");

    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the editor when the focused close button hides its view", () => {
    const { primarySidebar, focusEditor } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const close = byClass(outline, "view-close")[0];
    close.focus();

    close.dispatch("click");

    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("emits the latest snapshot after every user action", () => {
    const { activityBar, primarySidebar, onDidChange } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");

    byClass(outline, "view-collapse")[0].dispatch("click");
    expect(outline.classList.contains("collapsed")).toBe(true);
    expect(byClass(outline, "view-collapse")[0].getAttribute("aria-expanded")).toBe("false");
    expect(byClass(outline, "workbench-view-body")[0].classList.contains("hidden")).toBe(true);
    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");
    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");

    expect(onDidChange).toHaveBeenCalledTimes(3);
    expect(onDidChange.mock.calls[0][0].views.outline.collapsed).toBe(true);
    expect(onDidChange.mock.calls[1][0].parts.primarySidebar).toMatchObject({
      activeContainerId: "search",
      visible: true,
    });
    expect(onDidChange.mock.calls[2][0].parts.primarySidebar.visible).toBe(false);
  });

  it("persists one Primary Sidebar size change on pointer release", () => {
    const { primarySidebar, primaryResizer, workbench, onDidChange } = setup();

    (primaryResizer as unknown as TestElement).dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 100 });
    testWindow.dispatch("pointermove", { clientX: 180 });

    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("320px");
    expect(onDidChange).not.toHaveBeenCalled();

    testWindow.dispatch("pointerup");

    expect(workbench.snapshot().parts.primarySidebar.size).toBe(320);
    expect(onDidChange).toHaveBeenCalledTimes(1);
  });
});
