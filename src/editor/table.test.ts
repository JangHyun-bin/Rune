import { describe, it, expect } from "vitest";
import { parseAlignments } from "./table";

describe("parseAlignments", () => {
  it("reads :--: / --: / :-- / ---", () => {
    expect(parseAlignments("| :--- | :---: | ---: | --- |")).toEqual(["left", "center", "right", null]);
  });
  it("handles no leading/trailing pipes", () => {
    expect(parseAlignments(":-:|-:")).toEqual(["center", "right"]);
  });
});
