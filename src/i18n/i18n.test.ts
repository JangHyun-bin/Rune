import { describe, it, expect } from "vitest";
import { t, setLocale } from "./i18n";

describe("i18n", () => {
  it("returns ko string", () => { setLocale("ko"); expect(t("cmd.save")).toBe("저장"); });
  it("returns en string", () => { setLocale("en"); expect(t("cmd.save")).toBe("Save"); });
  it("interpolates params", () => { setLocale("en"); expect(t("status.words", { n: 3 })).toBe("3 words"); });
  it("falls back to en when key missing in locale", () => { setLocale("ja"); expect(typeof t("cmd.save")).toBe("string"); });
  it("returns the key itself if unknown", () => { setLocale("en"); expect(t("nope.nope")).toBe("nope.nope"); });
});
