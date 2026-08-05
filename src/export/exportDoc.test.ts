import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHtmlDocument, printHtmlDocument, showHtmlPreview } from "./exportDoc";

type Listener = () => void;

class TestElement {
  children: TestElement[] = [];
  className = "";
  srcdoc = "";
  textContent = "";
  type = "";
  style: Record<string, string> = {};
  parent: TestElement | null = null;
  contentWindow = { focus: vi.fn(), print: vi.fn() };
  contentDocument = { fonts: { ready: Promise.resolve() }, images: [] };
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

  it("builds printable project sections from the same HTML document", () => {
    const html = buildHtmlDocument("Book", "<table><tr><td>Body</td></tr></table>", {
      theme: "serif",
      pageSize: "Letter",
      margins: { top: 1, right: 11, bottom: 99, left: 13 },
      pageBreakDocuments: true,
      metadata: { author: "Writer", subject: "Report" },
    });

    expect(html).toContain("font-family:Georgia");
    expect(html).toContain("@page{size:Letter;margin:5mm 11mm 50mm 13mm}");
    expect(html).toContain(".project-document:not(:first-of-type){break-before:page");
    expect(html).toContain('<meta name="author" content="Writer">');
    expect(html).toContain('<meta name="description" content="Report">');
    expect(html).toContain(".project-title{break-after:page;page-break-after:always}");
    expect(html).toContain(".project-toc{break-after:page;page-break-after:always}");
    expect(html).toContain("tr,blockquote,.mermaid,figure,img{break-inside:avoid-page;page-break-inside:avoid}");
    expect(html).toContain("table{width:100%;table-layout:auto;break-inside:auto;page-break-inside:auto}");
    expect(html).toContain("pre.hljs{white-space:pre-wrap");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("blockquote,.mermaid,figure,img{break-inside:avoid-page;page-break-inside:avoid}");
    expect(html).toContain("img,svg{max-width:100%!important;height:auto!important}");
    expect(html).toContain(".mermaid svg{max-height:90vh}");
  });

  it("waits for the print document before opening the native print dialog", async () => {
    const printing = printHtmlDocument("<!doctype html><h1>Book</h1>", "Book");
    const iframe = body.children[0];

    expect(iframe.srcdoc).toContain("Book");
    expect(iframe.contentWindow.print).not.toHaveBeenCalled();
    iframe.dispatch("load");
    await printing;

    expect(iframe.contentWindow.focus).toHaveBeenCalledOnce();
    expect(iframe.contentWindow.print).toHaveBeenCalledOnce();
  });
});
