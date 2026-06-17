import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flattenPaneIds } from "./paneLayout";
import { createPaneWorkspace } from "./paneWorkspace";

type Listener = (event: Event) => void;

class TestElement {
  className = "";
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  draggable = false;
  parentElement: TestElement | null = null;
  style: Record<string, string> = {};
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
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
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
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
    const attributeMatch = selector.match(/^\[data-pane-id="([^"]+)"\]$/);
    if (attributeMatch) return this.dataset.paneId === attributeMatch[1];

    const classAttributeMatch = selector.match(/^\.([a-z0-9-]+)\[data-direction="([^"]+)"\]$/);
    if (classAttributeMatch) {
      return (
        this.className.split(/\s+/).includes(classAttributeMatch[1]) &&
        this.dataset.direction === classAttributeMatch[2]
      );
    }

    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }

    return this.tagName === selector.toLowerCase();
  }
}

function createTestDocument() {
  return {
    createElement: (tagName: string) => new TestElement(tagName),
  };
}

interface MockPane {
  id: string;
  root: HTMLElement;
  openPath: ReturnType<typeof vi.fn>;
  activePath: ReturnType<typeof vi.fn>;
  tabsSnapshot: ReturnType<typeof vi.fn>;
  setEditorMode: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface MockEditorPaneOptions {
  id: string;
  host: HTMLElement;
  editorMode: string;
  onRequestSaveSettings?: () => void;
}

const editorPaneMock = vi.hoisted(() => {
  const panes = new Map<string, MockPane>();
  const createEditorPane = vi.fn((options: MockEditorPaneOptions) => {
    let activePath: string | null = null;
    const openTabs: string[] = [];
    const root = document.createElement("div");
    root.className = "editor-pane-root";
    root.dataset.paneId = options.id;
    options.host.appendChild(root);

    const pane = {
      id: options.id,
      root,
      view: {},
      openPath: vi.fn(async (path: string) => {
        if (!openTabs.includes(path)) openTabs.push(path);
        activePath = path;
        options.onRequestSaveSettings?.();
      }),
      newDoc: vi.fn(),
      switchTo: vi.fn(),
      closeTab: vi.fn(),
      activePath: vi.fn(() => activePath),
      activeText: vi.fn(() => ""),
      activeDirty: vi.fn(() => false),
      tabsSnapshot: vi.fn(() => ({ openTabs: [...openTabs], activePath })),
      setEditorMode: vi.fn(),
      saveActive: vi.fn(async () => {}),
      destroy: vi.fn(() => root.remove()),
    };

    panes.set(options.id, pane);
    return pane;
  });

  return { createEditorPane, panes };
});

vi.mock("./editorPane", () => ({
  createEditorPane: editorPaneMock.createEditorPane,
}));

function makeWorkspace() {
  const host = document.createElement("div");
  const workspace = createPaneWorkspace({
    host,
    editorMode: "source",
    readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
    writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
    onActivePaneChange: vi.fn(),
    onActiveDocumentChange: vi.fn(),
    onRequestSaveSettings: vi.fn(),
  });
  return { host, workspace };
}

function paneRoot(host: HTMLElement, paneId: string): HTMLElement {
  const root = host.querySelector(`[data-pane-id="${paneId}"]`);
  if (!root) throw new Error(`Missing pane root: ${paneId}`);
  return root as HTMLElement;
}

function classTokens(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter((token) => token.length > 0);
}

describe("pane workspace", () => {
  beforeEach(() => {
    vi.stubGlobal("document", createTestDocument());
    editorPaneMock.createEditorPane.mockClear();
    editorPaneMock.panes.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with one pane and opens a path into the active pane", async () => {
    const { host, workspace } = makeWorkspace();

    await workspace.openPathInActivePane("/w/a.md");

    expect(host.className).toBe("pane-workspace");
    expect(workspace.activePane().activePath()).toBe("/w/a.md");
    expect(workspace.snapshot().panes[0].openTabs).toEqual(["/w/a.md"]);
    expect(workspace.snapshot().panes[0].activePath).toBe("/w/a.md");

    workspace.destroy();
  });

  it("splits the active pane and opens a path into the new pane", async () => {
    const { host, workspace } = makeWorkspace();
    await workspace.openPathInActivePane("/w/a.md");

    const paneId = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");
    const snapshot = workspace.snapshot();
    const split = host.querySelector(".pane-split[data-direction=\"row\"]") as unknown as TestElement;

    expect(snapshot.root.type).toBe("split");
    expect(split).not.toBeNull();
    expect(split.style.display).toBe("grid");
    expect(split.style.gridTemplateColumns).toBe("0.5fr 0.5fr");
    expect(workspace.activePane().id).toBe(paneId);
    expect(workspace.activePane().activePath()).toBe("/w/b.md");

    workspace.destroy();
  });

  it("setActivePane toggles the active class on pane roots", async () => {
    const { host, workspace } = makeWorkspace();

    const pane2 = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");

    expect(classTokens(paneRoot(host, "pane-1"))).not.toContain("active");
    expect(classTokens(paneRoot(host, pane2))).toContain("active");

    workspace.setActivePane("pane-1");

    expect(classTokens(paneRoot(host, "pane-1"))).toContain("active");
    expect(classTokens(paneRoot(host, pane2))).not.toContain("active");

    workspace.destroy();
  });

  it("setEditorMode propagates to all panes", async () => {
    const { workspace } = makeWorkspace();
    const pane2 = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");

    workspace.setEditorMode("split");

    expect(editorPaneMock.panes.get("pane-1")?.setEditorMode).toHaveBeenCalledWith("split");
    expect(editorPaneMock.panes.get(pane2)?.setEditorMode).toHaveBeenCalledWith("split");

    workspace.destroy();
  });

  it("snapshot pane order follows flattenPaneIds after before and after splits", async () => {
    const { workspace } = makeWorkspace();

    const pane2 = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");
    await workspace.splitPaneAndOpen("pane-1", "/w/c.md", "column", "before");
    const snapshot = workspace.snapshot();

    expect(snapshot.panes.map((pane) => pane.id)).toEqual(["pane-3", "pane-1", pane2]);
    expect(snapshot.panes.map((pane) => pane.id)).toEqual(flattenPaneIds(snapshot.root));

    workspace.destroy();
  });
});
