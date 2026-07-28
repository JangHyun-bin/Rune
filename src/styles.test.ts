import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const rule = (selector: string) =>
  styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`))?.[1] ?? "";

describe("workbench layout CSS", () => {
  it("keeps long editors and search results inside their scroll containers", () => {
    expect(rule("#main-col")).toMatch(/min-height:\s*0/);
    expect(rule('.workbench-view[data-view-id="search"]')).toMatch(/flex:\s*1/);
    expect(rule(".sp-card")).toMatch(/height:\s*100%/);
    expect(rule(".sp-list")).toMatch(/flex:\s*1/);
    expect(rule(".sp-list")).toMatch(/min-height:\s*0/);
    expect(rule(".sp-list")).toMatch(/overflow-y:\s*auto/);
  });
});
