import { describe, expect, it } from "vitest";
import { calibrateScreenPoint } from "./native-pointer.mjs";

describe("native pointer calibration", () => {
  it("maps a desired client point through the screen origin observed by a real pointer event", () => {
    expect(calibrateScreenPoint({
      calibrationScreen: { x: 884, y: 88 },
      observedClient: { x: 156, y: 68 },
      desiredClient: { x: 33.5, y: 27.9 },
      scaleFactor: 1,
    })).toEqual({ x: 761.5, y: 47.9 });
  });

  it("preserves physical scaling across a negative screen origin", () => {
    expect(calibrateScreenPoint({
      calibrationScreen: { x: -1750, y: 140 },
      observedClient: { x: 100, y: 80 },
      desiredClient: { x: 24, y: 16 },
      scaleFactor: 1.25,
    })).toEqual({ x: -1845, y: 60 });
  });
});
