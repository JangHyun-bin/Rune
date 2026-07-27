import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/i18n";
import { mountHelpPanel } from "./helpPanel";

type Listener = (event: Event) => void;

class TestElement {
  children: TestElement[] = [];
  className = "";
  parentElement: TestElement | null = null;
  textContent = "";
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();
  classList = {
    add: (...tokens: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const token of tokens) classes.add(token);
      this.className = [...classes].join(" ");
    },
    remove: (...tokens: string[]) => {
      const removed = new Set(tokens);
      this.className = this.className.split(/\s+/).filter((token) => token && !removed.has(token)).join(" ");
    },
    contains: (token: string) => this.className.split(/\s+/).includes(token),
  };

  appendChild(child: TestElement): TestElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: TestElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(...children: TestElement[]): void {
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

function walk(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap(walk)];
}

let body: TestElement;

beforeEach(() => {
  setLocale("en");
  body = new TestElement();
  vi.stubGlobal("document", {
    body,
    createElement: () => new TestElement(),
    addEventListener() {},
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("help panel", () => {
  it("shows localized Workbench navigation help without inventing a shortcut", () => {
    const panel = mountHelpPanel();

    panel.open();

    let note = walk(body).find((element) => element.className === "help-note");
    expect(note?.textContent).toBe("Use the Activity Bar to switch views. Use the Sidebar button in the title bar to show or hide the sidebar.");
    expect(note?.children).toHaveLength(0);
    expect(note?.textContent).not.toMatch(/Ctrl|⌘/);

    setLocale("ko");
    panel.close();
    panel.open();
    note = walk(body).find((element) => element.className === "help-note");
    expect(note?.textContent).toBe("활동 표시줄에서 보기를 전환하세요. 제목 표시줄의 사이드바 버튼으로 사이드바를 표시하거나 숨길 수 있습니다.");
  });
});
