import { afterEach, describe, expect, it, vi } from "vitest";
import { mountFileTree } from "./fileTree";

type Listener = (event: Event) => void;

class TestNode {
  className = "";
  children: TestNode[] = [];
  parentElement: TestNode | null = null;
  style: Record<string, string> = {};
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
});
