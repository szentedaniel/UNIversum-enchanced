import { DEFAULT_SETTINGS } from "@universum/protocol/messages";
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { customSettingsText } from "#text.ts";

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);
// Intl separates groups and units with no-break spaces; compare with plain ones.
const plain = (text: string) => text.replaceAll(/[\u00a0\u202f]/g, " ");

afterEach(() => {
  inLanguage(baseLocale);
});

describe("the Lobby list's custom-settings mark", () => {
  it("marks nothing on a Lobby on the default Room settings", () => {
    inLanguage("en");
    expect(customSettingsText(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("names a starting cash that differs from the default, with its value", () => {
    inLanguage("en");
    const custom = { ...DEFAULT_SETTINGS, startingCash: 1_500_000 as const };
    expect(customSettingsText(custom).map(plain)).toEqual(["Starting cash: Ft 1,500,000"]);
  });

  it("names every differing setting", () => {
    inLanguage("hu");
    const custom = { ...DEFAULT_SETTINGS, startingCash: 4_000_000 as const };
    expect(customSettingsText(custom).map(plain)).toEqual(["Kezdőtőke: 4 000 000 Ft"]);
  });

  it("names the Seat count and the Minute limit too, when they differ", () => {
    inLanguage("en");
    const custom = { ...DEFAULT_SETTINGS, maxPlayers: 2 as const, minuteLimit: 15 as const };
    expect(customSettingsText(custom)).toEqual(["2 players", "15 minutes"]);
  });

  it("names every differing setting at once", () => {
    inLanguage("de");
    const custom = {
      maxPlayers: 3 as const,
      minuteLimit: 30 as const,
      startingCash: 4_000_000 as const,
      roundBonus: 250_000 as const,
    };
    expect(customSettingsText(custom).map(plain)).toEqual([
      "3 Spieler",
      "30 Minuten",
      "Startkapital: 4.000.000 Ft",
    ]);
  });
});
