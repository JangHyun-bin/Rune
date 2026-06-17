import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorPane } from "./editorPane";

type Listener = (event: Event) => void;

class TestElement {
  className = "";
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  draggable = false;
  parentElement: TestElement | null = null;
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

  appendChild(child: TestElement): TestElement {
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

  dispatchEvent(event: Event): boolean {
    Object.defineProperty(event, "target", { value: this, configurable: true });
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  closest(selector: string): TestElement | null {
    let node: TestElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    const found: TestElement[] = [];
    const walk = (node: TestElement) => {
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

interface FakeDoc {
  readonly length: number;
  toString(): string;
}

interface FakeState {
  doc: FakeDoc;
  mode: string;
  onChange: (text: string) => void;
  getDocPath: () => string | null;
}

class FakeEditorView {
  dom: TestElement;
  scrollDOM: TestElement;
  state: FakeState;
  destroyed = false;

  constructor(parent: TestElement, state: FakeState) {
    this.state = state;
    this.dom = document.createElement("div") as unknown as TestElement;
    this.dom.className = "cm-editor";
    this.scrollDOM = document.createElement("div") as unknown as TestElement;
    parent.appendChild(this.dom);
  }

  setState(state: FakeState): void {
    this.state = state;
  }

  dispatch(spec: { changes?: { from: number; to: number; insert: string } }): void {
    const current = this.state.doc.toString();
    const changes = spec.changes;
    if (!changes) return;
    const next = current.slice(0, changes.from) + changes.insert + current.slice(changes.to);
    this.state = createFakeState(next, this.state.onChange, this.state.mode, this.state.getDocPath);
    this.state.onChange(next);
  }

  destroy(): void {
    this.destroyed = true;
    this.dom.remove();
  }
}

function createFakeState(
  text: string,
  onChange: (text: string) => void,
  mode: string,
  getDocPath: () => string | null,
): FakeState {
  return {
    doc: {
      get length() {
        return text.length;
      },
      toString() {
        return text;
      },
    },
    mode,
    onChange,
    getDocPath,
  };
}

vi.mock("../editor/editor", () => ({
  editorState: (
    doc: string,
    onChange: (text: string) => void,
    _extraExtensions: unknown[],
    mode: string,
    getDocPath: () => string | null,
  ) => createFakeState(doc, onChange, mode, getDocPath),
  createEditorView: (parent: TestElement, state: FakeState) => new FakeEditorView(parent, state),
}));

function createTestDocument() {
  return {
    createElement: (tagName: string) => new TestElement(tagName),
  };
}

function dispatch(element: HTMLElement, type: string): void {
  element.dispatchEvent(new Event(type));
}

function editActiveText(pane: ReturnType<typeof createEditorPane>, text: string): void {
  pane.view.dispatch({
    changes: { from: 0, to: pane.view.state.doc.length, insert: text },
  });
}

describe("editor pane", () => {
  beforeEach(() => {
    vi.stubGlobal("document", createTestDocument());
    vi.stubGlobal("window", {
      setTimeout: vi.fn((fn: () => void) => {
        fn();
        return 1;
      }),
      clearTimeout: vi.fn(),
      requestAnimationFrame: vi.fn((fn: () => void) => {
        fn();
        return 1;
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a path into a pane and reports active path", async () => {
    const host = document.createElement("div");
    const pane = createEditorPane({
      id: "pane-1",
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActiveChange: vi.fn(),
      onDirtyChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });

    await pane.openPath("/w/a.md");

    expect(pane.activePath()).toBe("/w/a.md");
    expect(host.querySelector(".pane-tabbar")).not.toBeNull();
    expect(host.querySelector(".pane-editor")).not.toBeNull();

    pane.destroy();
  });

  it("returns saved tabs in snapshots and excludes untitled tabs", async () => {
    const host = document.createElement("div");
    const pane = createEditorPane({
      id: "pane-1",
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActiveChange: vi.fn(),
      onDirtyChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });

    await pane.openPath("/w/a.md");
    await pane.openPath("/w/b.md");
    pane.newDoc();

    expect(pane.tabsSnapshot()).toEqual({
      openTabs: ["/w/a.md", "/w/b.md"],
      activePath: null,
    });

    pane.destroy();
  });

  it("notifies when the pane root or editor becomes active", () => {
    const host = document.createElement("div");
    const onActiveChange = vi.fn();
    const pane = createEditorPane({
      id: "pane-9",
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: path })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActiveChange,
      onDirtyChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });

    dispatch(pane.root, "mousedown");
    dispatch(pane.view.dom, "focusin");

    expect(onActiveChange).toHaveBeenCalledTimes(2);
    expect(onActiveChange).toHaveBeenNthCalledWith(1, "pane-9");
    expect(onActiveChange).toHaveBeenNthCalledWith(2, "pane-9");

    pane.destroy();
  });

  it("saves the active path text and clears dirty state", async () => {
    const host = document.createElement("div");
    const writeFile = vi.fn(async () => ({ status: "ok" as const, data: null }));
    const onDirtyChange = vi.fn();
    const pane = createEditorPane({
      id: "pane-1",
      host,
      editorMode: "source",
      readFile: vi.fn(async () => ({ status: "ok" as const, data: "# Old" })),
      writeFile,
      onActiveChange: vi.fn(),
      onDirtyChange,
      onRequestSaveSettings: vi.fn(),
    });

    await pane.openPath("/w/a.md");
    editActiveText(pane, "# Edited");

    expect(pane.activeDirty()).toBe(true);
    expect(onDirtyChange).toHaveBeenCalledWith("pane-1");

    await pane.saveActive();

    expect(writeFile).toHaveBeenCalledWith("/w/a.md", "# Edited");
    expect(pane.activeDirty()).toBe(false);

    pane.destroy();
  });
});
