import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/i18n";

const search = vi.hoisted(() => vi.fn());
const searchWorkspaceIndex = vi.hoisted(() => vi.fn());
const cancelSearch = vi.hoisted(() => vi.fn());
vi.mock("../ipc/bindings", () => ({ commands: { search, searchWorkspaceIndex, cancelSearch } }));

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
  hidden = false;
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

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, init: { key?: string } = {}): void {
    const event = { key: init.key ?? "", preventDefault: vi.fn(), target: this } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
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
    searchWorkspaceIndex.mockReset();
    cancelSearch.mockReset();
    cancelSearch.mockResolvedValue({ status: "ok", data: null });
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: [{ path: "C:/w/guide.md", line: 7, snippet: "needle" }],
    });
    search.mockResolvedValue({
      status: "ok",
      data: { hits: [{ path: "C:/w/guide.md", line: 7, snippet: "needle" }], truncated: false },
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
    expect(searchWorkspaceIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(searchWorkspaceIndex).toHaveBeenCalledOnce();
    expect(searchWorkspaceIndex).toHaveBeenCalledWith("C:/w", null, "needle", null, expect.any(Number));
    expect(host.querySelector(".sp-summary")?.textContent).toBe("1 result");

    (host.querySelector(".sp-row") as unknown as TestNode).dispatch("click");
    expect(openHit).toHaveBeenCalledWith("C:/w/guide.md", 7);

    setLocale("ko");
    panel.relabel();
    expect(input.placeholder).toBe("워크스페이스 검색…");
    expect((host.querySelector(".sp-scope") as unknown as TestNode).children.map((option) => option.textContent)).toEqual([
      "현재 문서",
      "현재 폴더",
      "워크스페이스",
    ]);
    expect((host.querySelector(".sp-scope") as unknown as TestNode).getAttribute("aria-label")).toBe("검색 범위");

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
    expect(searchWorkspaceIndex).not.toHaveBeenCalled();
  });

  it("relabels a visible empty-result message without refetching", async () => {
    searchWorkspaceIndex.mockResolvedValue({ status: "ok", data: [] });
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
    expect(searchWorkspaceIndex).toHaveBeenCalledOnce();
  });

  it("announces when only the first 200 results are shown", async () => {
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: {
        hits: Array.from({ length: 200 }, (_, index) => ({ path: "C:/w/a.md", line: index + 1, snippet: "needle" })),
        truncated: true,
      },
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");

    await vi.advanceTimersByTimeAsync(200);

    expect(host.querySelector(".sp-summary")?.textContent).toBe("Showing first 200 results");
  });

  it("searches the unsaved active document without calling the workspace backend", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(
      host,
      () => "C:/w",
      () => "C:/w/current.md",
      vi.fn(),
      () => "first line\nunsaved Needle here",
    );
    const scope = host.querySelector(".sp-scope") as unknown as TestNode;
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    scope.value = "document";
    scope.dispatch("change");
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    expect(searchWorkspaceIndex).not.toHaveBeenCalled();
    expect(host.querySelector(".sp-row")?.textContent).toContain("unsaved Needle here");
    expect(host.querySelector(".sp-line")?.textContent).toBe("2");
  });

  it("explains when current-document scope has no open document", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn(), () => null);
    const scope = host.querySelector(".sp-scope") as unknown as TestNode;
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    scope.value = "document";
    scope.dispatch("change");
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    expect(host.textContent).toContain("Open a document first");
    expect(searchWorkspaceIndex).not.toHaveBeenCalled();
  });

  it("searches an untitled active document and jumps without opening a path", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    const openHit = vi.fn();
    const jumpCurrent = vi.fn();
    mountSearchPanel(host, () => "C:/w", () => null, openHit, () => "draft\nneedle", jumpCurrent);
    const scope = host.querySelector(".sp-scope") as unknown as TestNode;
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    scope.value = "document";
    scope.dispatch("change");
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    (host.querySelector(".sp-row") as unknown as TestNode).dispatch("click");

    expect(jumpCurrent).toHaveBeenCalledWith(2);
    expect(openHit).not.toHaveBeenCalled();
  });

  it("searches either the active file folder or the full workspace", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => "C:/w/notes/current.md", vi.fn());
    const scope = host.querySelector(".sp-scope") as unknown as TestNode;
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";

    scope.value = "folder";
    scope.dispatch("change");
    await vi.advanceTimersByTimeAsync(200);
    expect(searchWorkspaceIndex).toHaveBeenLastCalledWith("C:/w", "C:/w/notes", "needle", "C:/w/notes/current.md", expect.any(Number));

    scope.value = "workspace";
    scope.dispatch("change");
    await vi.advanceTimersByTimeAsync(200);
    expect(searchWorkspaceIndex).toHaveBeenLastCalledWith("C:/w", null, "needle", "C:/w/notes/current.md", expect.any(Number));
  });

  it("falls back to the scan search while the workspace index is unavailable", async () => {
    searchWorkspaceIndex.mockResolvedValue({ status: "error", error: "workspace index is not ready" });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");

    await vi.advanceTimersByTimeAsync(200);

    expect(search).toHaveBeenCalledWith("C:/w", "needle", expect.any(Number));
    expect(host.querySelector(".sp-summary")?.textContent).toBe("1 result");
  });

  it("groups results by file with the active document first", async () => {
    searchWorkspaceIndex.mockResolvedValue({
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

  it("shows workspace-relative paths when file names are ambiguous", async () => {
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: [
        { path: "C:/w/a/index.md", line: 1, snippet: "needle" },
        { path: "C:/w/b/index.md", line: 2, snippet: "needle" },
      ],
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    expect(host.querySelectorAll(".sp-file").map((node) => node.textContent)).toEqual([
      "a/index.md",
      "b/index.md",
    ]);
  });

  it("reports the total and highlights every case-insensitive match", async () => {
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: [
        { path: "C:/w/a.md", line: 1, snippet: "Needle first" },
        { path: "C:/w/a.md", line: 2, snippet: "second needle" },
      ],
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    expect(host.querySelector(".sp-summary")?.textContent).toBe("2 results");
    expect(host.querySelectorAll(".sp-match").map((node) => node.textContent)).toEqual([
      "Needle",
      "needle",
    ]);
  });

  it("collapses and reopens each file group", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    const toggle = host.querySelector(".sp-group-toggle") as unknown as TestNode;
    const results = host.querySelector(".sp-group-results") as unknown as TestNode;

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.dispatch("click");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(results.hidden).toBe(true);
    toggle.dispatch("click");
    expect(results.hidden).toBe(false);
  });

  it("shows progress and ignores results after cancellation", async () => {
    let finishSearch!: (value: {
      status: "ok";
      data: { path: string; line: number; snippet: string }[];
    }) => void;
    searchWorkspaceIndex.mockReturnValue(new Promise((resolve) => { finishSearch = resolve; }));
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);

    const cancel = host.querySelector(".sp-cancel") as unknown as TestNode;
    expect(host.querySelector(".sp-summary")?.textContent).toBe("Searching…");
    expect(cancel.hidden).toBe(false);
    const requestId = searchWorkspaceIndex.mock.calls[0][4];
    cancel.dispatch("click");
    expect(cancelSearch).toHaveBeenCalledWith(requestId);
    finishSearch({
      status: "ok",
      data: [{ path: "C:/w/a.md", line: 1, snippet: "needle" }],
    });
    await Promise.resolve();

    expect(host.querySelector(".sp-summary")?.textContent).toBe("Search canceled");
    expect(host.querySelector(".sp-row")).toBeNull();
  });

  it("moves keyboard focus from the query through result rows", async () => {
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: [
        { path: "C:/w/a.md", line: 1, snippet: "needle one" },
        { path: "C:/w/a.md", line: 2, snippet: "needle two" },
      ],
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    const rows = host.querySelectorAll(".sp-row") as unknown as TestNode[];

    input.dispatch("keydown", { key: "ArrowDown" });
    expect(rows[0].focused).toBe(true);
    rows[0].dispatch("keydown", { key: "ArrowDown" });
    expect(rows[1].focused).toBe(true);
    rows[1].dispatch("keydown", { key: "ArrowUp" });
    expect(rows[0].focused).toBe(true);
  });

  it("skips rows inside collapsed groups during keyboard navigation", async () => {
    searchWorkspaceIndex.mockResolvedValue({
      status: "ok",
      data: [
        { path: "C:/w/a.md", line: 1, snippet: "needle one" },
        { path: "C:/w/b.md", line: 2, snippet: "needle two" },
      ],
    });
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    const rows = host.querySelectorAll(".sp-row") as unknown as TestNode[];
    (host.querySelector(".sp-group-toggle") as unknown as TestNode).dispatch("click");

    input.dispatch("keydown", { key: "ArrowDown" });

    expect(rows[0].focused).toBe(false);
    expect(rows[1].focused).toBe(true);
  });

  it("does not focus detached rows after a later search becomes empty", async () => {
    const testDocument = createTestDocument();
    vi.stubGlobal("document", testDocument);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const host = document.createElement("div");
    mountSearchPanel(host, () => "C:/w", () => null, vi.fn());
    const input = host.querySelector(".sp-input") as unknown as TestNode;
    input.value = "needle";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    const oldRow = host.querySelector(".sp-row") as unknown as TestNode;
    searchWorkspaceIndex.mockResolvedValue({ status: "ok", data: [] });

    input.value = "missing";
    input.dispatch("input");
    await vi.advanceTimersByTimeAsync(200);
    input.dispatch("keydown", { key: "ArrowDown" });

    expect(oldRow.focused).toBe(false);
  });
});
