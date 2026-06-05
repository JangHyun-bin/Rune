import { describe, it, expect } from "vitest";
import { DICT, LOCALES } from "./i18n";

describe("i18n key parity", () => {
  const enKeys = Object.keys(DICT.en);
  for (const { code } of LOCALES) {
    it(`${code} defines every English key`, () => {
      for (const k of enKeys) {
        expect(DICT[code][k], `${code} is missing "${k}"`).toBeTruthy();
      }
    });
  }
});
