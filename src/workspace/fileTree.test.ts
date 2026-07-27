import { afterEach, describe, expect, it, vi } from "vitest";
import { mountFileTree } from "./fileTree";
import { mountOutlinePanel } from "./outlinePanel";
import { setLocale } from "../i18n/i18n";

type Listener = (event: Event) => void;

class TestNode {
  className = "";
  children: TestNode[] = [];
  parentElement: TestNode | null = null;
  style = {
    values: {} as Record<string, string>,
    setProperty: (name: string, value: string) => {
      this.style.values[name] = value;
    },
  };
  tagName: string;
  title = "";
  type = "";
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

  get classList() {
    return {
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
  return {
    createElement: (tagName: string) => new TestNode(tagName),
    createElementNS: (_namespace: string, tagName: string) => new TestNode(tagName),
    createTextNode: (text: string) => {
      const node = new TestNode("#text");
      node.textContent = text;
      return node;
    },
  };
}

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
});
