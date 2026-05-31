import { describe, it, expect } from "vitest";
import { mdRender } from "./render";

describe("export markdown render", () => {
  it("renders heading and bold", () => {
    const h = mdRender("# 제목\n\n**굵게**");
    expect(h).toContain("<h1>");
    expect(h).toContain("<strong>굵게</strong>");
  });
  it("renders a fenced code block", () => {
    expect(mdRender("```js\nconst x = 1;\n```")).toContain("<pre");
  });
  it("renders a GFM-ish table or list", () => {
    expect(mdRender("- a\n- b")).toContain("<ul>");
  });
});
