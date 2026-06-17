import { afterEach, describe, expect, it, vi } from "vitest";
import { horizontalRuleSpec } from "./horizontalRule";

type TestElement = {
  className: string;
  tagName: string;
  children: TestElement[];
  appendChild(child: TestElement): TestElement;
  querySelector(selector: string): TestElement | null;
};

function createTestElement(tagName: string): TestElement {
  return {
    className: "",
    tagName: tagName.toLowerCase(),
    children: [],
    appendChild(child: TestElement) {
      this.children.push(child);
      return child;
    },
    querySelector(selector: string) {
      return this.children.find((child) => child.tagName === selector.toLowerCase()) ?? null;
    },
  };
}

describe("horizontalRuleSpec", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the CodeMirror markdown HorizontalRule node", () => {
    expect(horizontalRuleSpec.match({} as never, "HorizontalRule", 0, 3)).toBe(true);
    expect(horizontalRuleSpec.match({} as never, "Paragraph", 0, 3)).toBe(false);
  });

  it("renders an inert horizontal rule element", () => {
    vi.stubGlobal("document", { createElement: createTestElement });

    const el = horizontalRuleSpec.render("---");
    expect(el.className).toBe("cm-md-hr");
    expect(el.querySelector("hr")).not.toBeNull();
  });
});
