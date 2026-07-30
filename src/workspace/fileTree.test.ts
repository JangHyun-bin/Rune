import { afterEach, describe, expect, it, vi } from "vitest";
import { mountFileTree } from "./fileTree";
import { mountOutlinePanel } from "./outlinePanel";
import { mountCommandPalette } from "./commandPalette";
import { setLocale } from "../i18n/i18n";

type Listener = (event: Event) => void;

class TestNode {
  className = "";
  children: TestNode[] = [];
  parentElement: TestNode | null = null;
  disabled = false;
  focused = false;
  focusCalls = 0;
  onFocus: (() => void) | null = null;
  placeholder = "";
  scrollIntoViewCalls = 0;
  style = {
    values: {} as Record<string, string>,
    setProperty: (name: string, value: string) => {
      this.style.values[name] = value;
    },
  };
  tagName: string;
  tabIndex = 0;
  title = "";
  type = "";
  value = "";
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

  append(...children: TestNode[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: TestNode): TestNode {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: TestNode[]): void {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener(new Event("click"));
    }
  }

  dispatch(type: string, event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
    this.focusCalls += 1;
    this.onFocus?.();
  }

  scrollIntoView(): void {
    this.scrollIntoViewCalls += 1;
  }

  get classList() {
    return {
      add: (name: string) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        names.add(name);
        this.className = [...names].join(" ");
      },
      contains: (name: string) => this.className.split(/\s+/).includes(name),
      remove: (name: string) => {
        this.className = this.className.split(/\s+/).filter((item) => item && item !== name).join(" ");
      },
      toggle: (name: string, force?: boolean) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !names.has(name);
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
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
  const fakeDocument = {
    activeElement: null as TestNode | null,
    body: null as unknown as TestNode,
    createElement: (tagName: string) => createNode(tagName),
    createElementNS: (_namespace: string, tagName: string) => createNode(tagName),
    createTextNode: (text: string) => {
      const node = createNode("#text");
      node.textContent = text;
      return node;
    },
  };
  function createNode(tagName: string): TestNode {
    const node = new TestNode(tagName);
    node.onFocus = () => { fakeDocument.activeElement = node; };
    return node;
  }
  fakeDocument.body = createNode("body");
  return fakeDocument;
}

describe("mountCommandPalette", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("returns focus to the previous element when Escape closes it", () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    const editor = document.createElement("button");
    document.body.appendChild(editor);
    editor.focus();
    const palette = mountCommandPalette(() => []);

    palette.toggle();
    const input = document.body.querySelector(".cp-input") as unknown as TestNode;
    input.dispatch("keydown", Object.assign(new Event("keydown"), { key: "Escape" }));

    expect(testDocument.activeElement).toBe(editor);
  });
});

describe("mountFileTree", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("shows workspace action buttons when a folder is loaded", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const openFile = vi.fn();
    const openFolder = vi.fn();
    const menu = vi.fn();
    const newFile = vi.fn();
    const newFolder = vi.fn();

    const tree = mountFileTree(host, openFile, openFolder, menu, { onNewFile: newFile, onNewFolder: newFolder });
    tree.render([{ name: "a.md", path: "C:/w/a.md", isDir: false, children: [] }], "C:/w");

    expect(host.querySelector(".ft-actions")).not.toBeNull();
    expect(host.textContent).toContain("Workspace");

    const actionButtons = host.querySelectorAll(".ft-action") as unknown as HTMLElement[];
    expect(actionButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Change Folder...", "New file…", "New folder…"]);
    expect(actionButtons.map((button) => button.title)).toEqual(["Change Folder...", "New file…", "New folder…"]);
    expect(actionButtons.every((button) => button.textContent === "")).toBe(true);
    expect(actionButtons.every((button) => button.querySelector("svg") !== null)).toBe(true);

    actionButtons[0].click();
    actionButtons[1].click();
    actionButtons[2].click();

    expect(openFolder).toHaveBeenCalledOnce();
    expect(newFile).toHaveBeenCalledOnce();
    expect(newFolder).toHaveBeenCalledOnce();
  });

  it("relabels without losing expanded folders and clears its host on dispose", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const tree = mountFileTree(host, vi.fn(), vi.fn(), vi.fn());
    tree.render([{
      name: "docs",
      path: "C:/w/docs",
      isDir: true,
      children: [{ name: "guide.md", path: "C:/w/docs/guide.md", isDir: false, children: [] }],
    }], "C:/w");

    (host.querySelector(".ft-row") as HTMLElement).click();
    expect(host.textContent).toContain("guide.md");

    setLocale("ko");
    tree.relabel();

    expect(host.textContent).toContain("워크스페이스");
    expect(host.textContent).toContain("guide.md");

    tree.showNoFolder();
    expect(host.textContent).toContain("열린 폴더가 없습니다.");

    tree.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe("mountOutlinePanel", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("relabels without losing headings or the active line and clears its host on dispose", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "First", line: 1 },
      { level: 2, text: "Second", line: 3 },
    ]);
    outline.setActiveLine(4);

    setLocale("ko");
    outline.relabel();

    expect(host.textContent).toContain("개요");
    expect(host.textContent).toContain("First");
    expect(host.textContent).toContain("Second");
    const rows = host.querySelectorAll(".outline-row");
    expect(rows[0].className).toBe("outline-row");
    expect(rows[1].className).toBe("outline-row active");

    outline.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("renders a collapsible heading tree", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "Chapter", line: 1 },
      { level: 2, text: "Background", line: 2 },
      { level: 3, text: "Details", line: 3 },
      { level: 1, text: "Next", line: 4 },
    ]);

    const rows = host.querySelectorAll(".outline-row");
    expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual(["1", "2", "3", "1"]);
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");

    const toggle = host.querySelector(".outline-toggle") as unknown as TestNode;
    expect(toggle.tabIndex).toBe(-1);
    toggle.click();

    expect(host.querySelectorAll(".outline-row").map((row) => row.textContent)).toEqual(["Chapter", "Next"]);
    expect(host.querySelector(".outline-row")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters headings while preserving the matching ancestor path", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "Chapter", line: 1 },
      { level: 2, text: "Background", line: 2 },
      { level: 3, text: "Network Model", line: 3 },
      { level: 2, text: "Results", line: 4 },
    ]);

    const filter = host.querySelector(".outline-filter") as unknown as TestNode;
    filter.value = "network";
    filter.dispatch("input");

    expect(host.querySelectorAll(".outline-row").map((row) => row.textContent)).toEqual([
      "Chapter",
      "Background",
      "Network Model",
    ]);
  });

  it("keeps the existing rows when the heading structure is unchanged", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    const headings = [
      { level: 1, text: "Chapter", line: 1 },
      { level: 2, text: "Background", line: 2 },
    ];
    outline.render(headings);
    const firstRow = host.querySelector(".outline-row");

    outline.render(headings.map((heading) => ({ ...heading })));

    expect(host.querySelector(".outline-row")).toBe(firstRow);
  });

  it("reveals the active visible heading and supports arrow-key navigation", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "First", line: 1 },
      { level: 2, text: "Second", line: 3 },
      { level: 1, text: "Third", line: 5 },
    ]);

    outline.setActiveLine(4);

    const rows = host.querySelectorAll(".outline-row") as TestNode[];
    expect(rows[1].className).toBe("outline-row active");
    expect(rows[1].scrollIntoViewCalls).toBe(1);

    const down = Object.assign(new Event("keydown"), { key: "ArrowDown" });
    rows[0].dispatch("keydown", down);
    expect(rows[1].focused).toBe(true);
  });

  it("moves tree focus upward with ArrowUp", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "First", line: 1 },
      { level: 1, text: "Second", line: 2 },
    ]);

    const rows = host.querySelectorAll(".outline-row") as TestNode[];
    rows[1].dispatch("keydown", Object.assign(new Event("keydown"), { key: "ArrowUp" }));

    expect(rows[0].focused).toBe(true);
  });

  it("collapses, expands, and enters heading branches with horizontal arrow keys", () => {
    vi.stubGlobal("document", createTestDocument());
    const host = document.createElement("div");
    const outline = mountOutlinePanel(host, vi.fn());
    outline.render([
      { level: 1, text: "Chapter", line: 1 },
      { level: 2, text: "Child", line: 2 },
      { level: 1, text: "Next", line: 3 },
    ]);

    let rows = host.querySelectorAll(".outline-row") as TestNode[];
    rows[0].dispatch("keydown", Object.assign(new Event("keydown"), { key: "ArrowLeft" }));
    rows = host.querySelectorAll(".outline-row") as TestNode[];
    expect(rows.map((row) => row.textContent)).toEqual(["Chapter", "Next"]);
    expect(rows[0].focused).toBe(true);

    rows[0].dispatch("keydown", Object.assign(new Event("keydown"), { key: "ArrowRight" }));
    rows = host.querySelectorAll(".outline-row") as TestNode[];
    expect(rows.map((row) => row.textContent)).toEqual(["Chapter", "Child", "Next"]);

    const childFocusCalls = rows[1].focusCalls;
    rows[0].dispatch("keydown", Object.assign(new Event("keydown"), { key: "ArrowRight" }));
    expect(rows[1].focusCalls).toBe(childFocusCalls + 1);
  });
});
