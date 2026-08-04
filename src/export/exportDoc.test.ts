import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showHtmlPreview } from "./exportDoc";

type Listener = () => void;

class TestElement {
  children: TestElement[] = [];
  className = "";
  srcdoc = "";
  textContent = "";
  type = "";
  parent: TestElement | null = null;
  private listeners = new Map<string, Listener[]>();
  private attributes = new Map<string, string>();

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  appendChild(child: TestElement): TestElement {
    this.append(child);
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
}

let body: TestElement;

beforeEach(() => {
  body = new TestElement();
  vi.stubGlobal("document", {
    body,
    createElement: () => new TestElement(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("HTML preview", () => {
  it("shows the generated document in a closable iframe", () => {
    showHtmlPreview("<!doctype html><h1>Project</h1>", "Project preview");

    expect(body.children).toHaveLength(1);
    const overlay = body.children[0];
    expect(overlay.className).toBe("project-preview-overlay");
    const dialog = overlay.children[0];
    expect(dialog.children[0].textContent).toBe("Project preview");
    expect(dialog.children[1].srcdoc).toBe("<!doctype html><h1>Project</h1>");

    dialog.children[2].dispatch("click");
    expect(body.children).toHaveLength(0);
  });
});
