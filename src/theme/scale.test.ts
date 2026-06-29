import { describe, it, expect } from "vitest";
import {
  clampUiScale,
  clampEditorFontScale,
  stepEditorFontScale,
  UI_SCALE_DEFAULT,
  EDITOR_FONT_DEFAULT,
} from "./scale";

describe("clampUiScale", () => {
  it("snaps to the nearest allowed step", () => {
    expect(clampUiScale(1.04)).toBe(1.0);
    expect(clampUiScale(1.15)).toBe(1.1);
    expect(clampUiScale(1.2)).toBe(1.25);
  });
  it("clamps out-of-range values to the ends", () => {
    expect(clampUiScale(5)).toBe(1.5);
    expect(clampUiScale(0.1)).toBe(0.8);
  });
  it("falls back to default on non-finite input", () => {
    expect(clampUiScale(NaN)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(Infinity)).toBe(UI_SCALE_DEFAULT);
  });
});

describe("clampEditorFontScale", () => {
  it("clamps to [0.75, 1.75]", () => {
    expect(clampEditorFontScale(2)).toBe(1.75);
    expect(clampEditorFontScale(0.5)).toBe(0.75);
    expect(clampEditorFontScale(1.2)).toBe(1.2);
  });
  it("falls back to default on non-finite input", () => {
    expect(clampEditorFontScale(NaN)).toBe(EDITOR_FONT_DEFAULT);
  });
});

describe("stepEditorFontScale", () => {
  it("steps by 0.1 in the given direction", () => {
    expect(stepEditorFontScale(1.0, 1)).toBe(1.1);
    expect(stepEditorFontScale(1.0, -1)).toBe(0.9);
  });
  it("does not exceed the bounds", () => {
    expect(stepEditorFontScale(1.75, 1)).toBe(1.75);
    expect(stepEditorFontScale(0.75, -1)).toBe(0.75);
  });
});
