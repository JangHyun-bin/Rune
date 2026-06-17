import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTabBar } from "./tabBar";
import { emptyTabs, openOrFocus } from "./tabs";

type Listener = (event: Event) => void;

class TestNode {
  className = "";
  children: TestNode[] = [];
  dataset: Record<string, string> = {};
  draggable = false;
  parentElement: TestNode | null = null;
  tagName: string;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();
  private text = "";

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string | null) {
    this.text = value ?? "";
    this.children = [];
  }

  appendChild(child: TestNode): TestNode {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: TestNode[]): void {
    this.children = [];
    for (const child of children) this.appendChild(child);
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

  dispatch(type: string, event: Partial<DragEvent> = {}): void {
    const dispatched = {
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: this,
      ...event,
    } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(dispatched);
  }

  closest(selector: string): TestNode | null {
    let node: TestNode | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector: string): TestNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestNode[] {
    const found: TestNode[] = [];
    const walk = (node: TestNode) => {
      if (node.matches(selector)) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return found;
  }

  private matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    return this.tagName === selector.toLowerCase();
  }
}

function createTestDocument() {
  return {
    createElement: (tagName: string) => new TestNode(tagName),
  };
}

describe("tab bar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the supplied pane id to the host and renders draggable tabs", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const state = openOrFocus(emptyTabs(), "/w/a.md", "A");

    mountTabBar(host, {
      paneId: "pane-2",
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      onTabDragStart: vi.fn(),
    }).render(state);

    const tab = host.querySelector(".tab") as unknown as TestNode;
    expect(host.dataset.paneId).toBe("pane-2");
    expect(tab.draggable).toBe(true);
    expect(tab.getAttribute("draggable")).toBe("true");
  });

  it("sends pane id, tab id, path, and duplicate false on normal dragstart", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const state = openOrFocus(emptyTabs(), "/w/a.md", "A");
    const onTabDragStart = vi.fn();

    mountTabBar(host, {
      paneId: "pane-3",
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      onTabDragStart,
    }).render(state);

    const tab = host.querySelector(".tab") as unknown as TestNode;
    tab.dispatch("dragstart");

    expect(onTabDragStart).toHaveBeenCalledWith({
      paneId: "pane-3",
      tabId: state.tabs[0].id,
      path: "/w/a.md",
      duplicate: false,
    });
  });

  it("marks ctrl or meta drags as duplicate", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const state = openOrFocus(emptyTabs(), "/w/a.md", "A");
    const onTabDragStart = vi.fn();

    mountTabBar(host, {
      paneId: "pane-4",
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      onTabDragStart,
    }).render(state);

    const tab = host.querySelector(".tab") as unknown as TestNode;
    tab.dispatch("dragstart", { ctrlKey: true });

    expect(onTabDragStart).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
  });

  it("defaults to pane-1 when pane id is omitted", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const state = openOrFocus(emptyTabs(), "/w/a.md", "A");
    const onTabDragStart = vi.fn();

    mountTabBar(host, {
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      onTabDragStart,
    }).render(state);

    const tab = host.querySelector(".tab") as unknown as TestNode;
    tab.dispatch("dragstart", { metaKey: true });

    expect(host.dataset.paneId).toBe("pane-1");
    expect(onTabDragStart).toHaveBeenCalledWith(expect.objectContaining({
      paneId: "pane-1",
      duplicate: true,
    }));
  });
});
