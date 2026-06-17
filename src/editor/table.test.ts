import { describe, it, expect } from "vitest";
import { parseAlignments, tableCellEditOffset } from "./table";

describe("parseAlignments", () => {
  it("reads :--: / --: / :-- / ---", () => {
    expect(parseAlignments("| :--- | :---: | ---: | --- |")).toEqual(["left", "center", "right", null]);
  });
  it("handles no leading/trailing pipes", () => {
    expect(parseAlignments(":-:|-:")).toEqual(["center", "right"]);
  });
});

describe("tableCellEditOffset", () => {
  it("points at the clicked rendered table cell in the source table", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";

    expect(tableCellEditOffset(source, 0, 1)).toBe(source.indexOf("B"));
    expect(tableCellEditOffset(source, 2, 1)).toBe(source.indexOf("2"));
  });

  it("handles tables without leading pipes", () => {
    const source = "A | B\n--- | ---\n1 | 2";

    expect(tableCellEditOffset(source, 2, 1)).toBe(source.indexOf("2"));
  });
});
