import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { formatCompactMoney, formatMoney } from "#text.ts";

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);
// Intl separates groups and units with no-break spaces; compare with plain ones.
const plain = (text: string) => text.replaceAll(/[  ]/g, " ");

afterEach(() => {
  inLanguage(baseLocale);
});

describe("money in full (cards and panels)", () => {
  it("follows the active language's number format, in forints", () => {
    inLanguage("hu");
    expect(plain(formatMoney(1_200_000))).toBe("1 200 000 Ft");
    inLanguage("en");
    expect(plain(formatMoney(1_200_000))).toBe("Ft 1,200,000");
    inLanguage("de");
    expect(plain(formatMoney(1_200_000))).toBe("1.200.000 Ft");
  });

  it("shows whole forints only", () => {
    inLanguage("en");
    expect(plain(formatMoney(75_000.4))).toBe("Ft 75,000");
  });
});

describe("money in short (the Board)", () => {
  it("is compact in the active language", () => {
    inLanguage("hu");
    expect(plain(formatCompactMoney(1_200_000))).toBe("1,2 M");
    inLanguage("en");
    expect(plain(formatCompactMoney(1_200_000))).toBe("1.2M");
    expect(plain(formatCompactMoney(75_000))).toBe("75K");
    inLanguage("de");
    expect(plain(formatCompactMoney(1_200_000))).toBe("1,2 Mio.");
  });
});
