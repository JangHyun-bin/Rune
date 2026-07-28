import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/i18n";

const search = vi.hoisted(() => vi.fn());
vi.mock("../ipc/bindings", () => ({ commands: { search } }));

import { mountSearchPanel } from "./searchPanel";

type Listener = (event: Event) => void;

class TestNode {
  className = "";
  children: TestNode[] = [];
  parentElement: TestNode | null = null;
  placeholder = "";
  tagName: string;
  type = "";
  value = "";
  focused = false;
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

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    const event = { key: "", preventDefault: vi.fn(), target: this } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
  }

  querySelector(selector: string): TestNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestNode[] {
    const found: TestNode[] = [];
    const walk = (node: TestNode) => {
      if (node.className.split(/\s+/).includes(selector.slice(1))) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return found;
  }
}

function createTestDocument() {
  return {
    body: new TestNode("body"),
    createElement: (tagName: string) => new TestNode(tagName),
  };
}

describe("mountSearchPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    search.mockResolvedValue({
      status: "ok",
      data: [{ path: "C:/w/guide.md", line: 7, snippet: "needle" }],
    });
  });

  afterEach(() => {
    setLocale("en");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts in its host, focuses, debounces search, and opens a selected result", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    const openHit = vi.fn();
    const panel = mountSearchPanel(host, () => "C:/w", () => null, openHit);

    expect(host.querySelector(".sp-card")).not.toBeNull();
    expect(testDocument.body.children).toHaveLength(0);

    panel.focus();
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    expect(input.focused).toBe(true);
    input.value = "needle";
    input.dispatch("input");

    await vi.advanceTimersByTimeAsync(199);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("C:/w", "needle");

    (host.querySelector(".sp-row") as unknown as TestNode).dispatch("click");
    expect(openHit).toHaveBeenCalledWith("C:/w/guide.md", 7);

    setLocale("ko");
    panel.relabel();
    expect(input.placeholder).toBe("워크스페이스 검색…");

    panel.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("relabels a visible no-folder message without resetting the query", () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    const panel = mountSearchPanel(host, () => null, () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    expect(host.textContent).toContain("Open a folder first");

    setLocale("ko");
    panel.relabel();

    expect(host.textContent).toContain("폴더를 먼저 여세요");
    expect(input.value).toBe("needle");
    expect(search).not.toHaveBeenCalled();
  });

  it("relabels a visible empty-result message without refetching", async () => {
    search.mockResolvedValue({ status: "ok", data: [] });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    const panel = mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    expect(host.textContent).toContain("No results");

    setLocale("ko");
    panel.relabel();

    expect(host.textContent).toContain("결과 없음");
    expect(input.value).toBe("needle");
    expect(search).toHaveBeenCalledOnce();
  });

  it("groups results by file with the active document first", async () => {
    search.mockResolvedValue({
      status: "ok",
      data: [
        { path: "C:/w/other.md", line: 8, snippet: "other" },
        { path: "C:\\w\\current.md", line: 4, snippet: "first" },
        { path: "C:\\w\\current.md", line: 12, snippet: "second" },
      ],
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => "c:/w/current.md", vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    expect(host.querySelectorAll(".sp-file").map((node) => node.textContent)).toEqual([
      "current.md",
      "other.md",
    ]);
    expect(host.querySelectorAll(".sp-group")[0].className).toContain("current");
    expect(host.querySelectorAll(".sp-count").map((node) => node.textContent)).toEqual(["2", "1"]);
  });
});
