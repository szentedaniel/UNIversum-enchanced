import type { GameSummary, PlayerView } from "@universum/rules";
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { summaryView } from "#pick/summary.ts";
import { formatMoney } from "#text.ts";

// The summary view-model (spec #177, ticket #237) joins the engine's Summary
// figures to the view's Players, so the panel can show names and colours with
// playerName and playerLook. No rule logic and no recomputed Wealth, Rent or
// Value: every figure is the one the final view carries.

const EMPTY: GameSummary = {
  biggestRent: null,
  fieldsBought: {},
  monopolies: [],
  bankruptcies: [],
};

function player(id: string, seat: number): PlayerView {
  return {
    id,
    name: { adjective: "happy", noun: "tiger" },
    seat,
    cash: 0,
    wealth: 0,
    position: 0,
    bankrupt: false,
    quarantineRounds: null,
    hasPcrTest: false,
    bot: false,
  };
}

const players = [player("p1", 0), player("p2", 1), player("p3", 2)];
const [p1, p2, p3] = players;

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);
// Intl separates groups and units with no-break spaces; compare with plain ones.
const plain = (text: string) => text.replaceAll(/[\u00A0\u202F]/g, " ");

afterEach(() => {
  inLanguage(baseLocale);
});

describe("the summary view-model", () => {
  it("joins the biggest Rent, the top buyer, the Monopolies and the Bankruptcies to the view's Players", () => {
    const summary: GameSummary = {
      biggestRent: { payer: "p2", owner: "p1", field: 5, amount: 1_200_000 },
      fieldsBought: { p1: 2, p2: 4, p3: 0 },
      monopolies: [
        { player: "p1", group: 1 },
        { player: "p1", group: 2 },
      ],
      bankruptcies: ["p3"],
    };

    expect(summaryView(players, summary)).toEqual({
      biggestRent: { payer: p2, owner: p1, field: 5, amount: 1_200_000 },
      topBuyer: { player: p2, count: 4 },
      monopolies: [
        { player: p1, group: 1 },
        { player: p1, group: 2 },
      ],
      bankruptcies: [p3],
    });
  });

  it("yields explicit empty values for a game where nothing happened", () => {
    expect(summaryView(players, EMPTY)).toEqual({
      biggestRent: null,
      topBuyer: null,
      monopolies: [],
      bankruptcies: [],
    });
  });

  it("names the biggest Rent's payer, owner and Field", () => {
    const summary: GameSummary = {
      ...EMPTY,
      biggestRent: { payer: "p1", owner: "p3", field: 21, amount: 750_000 },
    };

    expect(summaryView(players, summary).biggestRent).toEqual({
      payer: p1,
      owner: p3,
      field: 21,
      amount: 750_000,
    });
  });

  it("keeps the earlier Player in the view's order when two bought the same number of Fields", () => {
    const summary: GameSummary = { ...EMPTY, fieldsBought: { p1: 3, p2: 3, p3: 1 } };

    expect(summaryView(players, summary).topBuyer).toEqual({ player: p1, count: 3 });
  });

  it("has no top buyer when no Player bought a Field", () => {
    expect(summaryView(players, { ...EMPTY, fieldsBought: { p1: 0, p2: 0 } }).topBuyer).toBeNull();
    expect(summaryView(players, EMPTY).topBuyer).toBeNull();
  });

  it("skips a figure whose Player the view does not carry", () => {
    const summary: GameSummary = {
      biggestRent: { payer: "gone", owner: "p1", field: 5, amount: 1_000_000 },
      fieldsBought: { p1: 2, gone: 9 },
      monopolies: [
        { player: "gone", group: 1 },
        { player: "p2", group: 3 },
      ],
      bankruptcies: ["gone", "p3"],
    };

    expect(summaryView(players, summary)).toEqual({
      biggestRent: null,
      topBuyer: { player: p1, count: 2 },
      monopolies: [{ player: p2, group: 3 }],
      bankruptcies: [p3],
    });
    expect(
      summaryView(players, {
        ...EMPTY,
        biggestRent: { payer: "p1", owner: "gone", field: 5, amount: 1 },
      }).biggestRent,
    ).toBeNull();
  });

  it("hands the Rent over as a number, which the money helper formats per language", () => {
    const summary: GameSummary = {
      ...EMPTY,
      biggestRent: { payer: "p2", owner: "p1", field: 5, amount: 1_200_000 },
    };
    const amount = summaryView(players, summary).biggestRent?.amount ?? 0;

    inLanguage("hu");
    expect(plain(formatMoney(amount))).toBe("1 200 000 Ft");
    inLanguage("en");
    expect(plain(formatMoney(amount))).toBe("Ft 1,200,000");
    inLanguage("de");
    expect(plain(formatMoney(amount))).toBe("1.200.000 Ft");
  });
});
