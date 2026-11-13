import type { GameEvent } from "@universum/rules";
import { describe, expect, it } from "vitest";
import { EVENT_PRESENTATION } from "#playback/presentation.ts";
import { CUES, EVENT_CUES, cuesReached, type CueName } from "#sound/cues.ts";
import { ROLL } from "./playback-fixtures.ts";

// The cue table (spec #178): one exhaustive row per event type saying which
// sound it starts, or an explicit silence. A new event type fails to compile
// until it has a row, and this test fails until the row is pinned here.

/** Every event's cue: the dice on a roll, a purchase on a buy, Rent on Rent, silence elsewhere. */
const CUED = {
  DiceRolled: "dice",
  Moved: "none",
  RoundBonusPaid: "none",
  LevelBought: "buy",
  MuseumBought: "buy",
  BoughtOut: "buy",
  OfferDeclined: "none",
  RentPaid: "rent",
  CardDrawn: "none",
  ChanceMoneyReceived: "none",
  ChanceChargePaid: "none",
  ChanceTransferPaid: "none",
  TaxPaid: "none",
  QuarantineEntered: "none",
  QuarantineRoundUsed: "none",
  QuarantineReleased: "none",
  PcrTestBought: "none",
  PcrTestUsed: "none",
  FieldsSold: "none",
  WentBankrupt: "none",
  TimedOut: "none",
  TimeoutPenaltyPaid: "none",
  DoublerPlaced: "none",
  DealProposed: "none",
  DealAccepted: "none",
  DealDeclined: "none",
  DealExpired: "none",
  GameEnded: "none",
  TurnPassed: "none",
} satisfies Record<GameEvent["type"], CueName | "none">;

/** Some silent neighbours either side of a roll. */
const EVENTS: readonly GameEvent[] = [
  { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
  { type: "DiceRolled", player: "p1", dice: [3, 4] },
  { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
  { type: "DiceRolled", player: "p2", dice: [1, 2] },
];

describe("the cue table", () => {
  it("lists every event type with its cue or an explicit silence", () => {
    expect(EVENT_CUES).toEqual(CUED);
    // The presentation table is exhaustive too, so the two agree on the set.
    expect(Object.keys(EVENT_CUES).toSorted()).toEqual(Object.keys(EVENT_PRESENTATION).toSorted());
  });

  it("names the effect file of every cue, with purchase and Rent in different files", () => {
    expect(CUES.dice).toContain("dice.mp3");
    expect(CUES.buy).toContain("buy.mp3");
    expect(CUES.rent).toContain("rent.mp3");
    expect(CUES.buy).not.toBe(CUES.rent);
  });
});

describe("cuesReached", () => {
  it("returns the cues of the events in the half-open range, in order", () => {
    expect(cuesReached(EVENTS, 0, EVENTS.length)).toEqual(["dice", "rent", "dice"]);
    expect(cuesReached(EVENTS, 1, 2)).toEqual(["dice"]);
    expect(cuesReached(EVENTS, 2, 4)).toEqual(["rent", "dice"]);
  });

  it("returns nothing for a range of silent events or an empty range", () => {
    expect(cuesReached(EVENTS, 0, 1)).toEqual([]);
    expect(cuesReached(EVENTS, 4, 4)).toEqual([]);
  });

  it("clamps a range to the events it has", () => {
    expect(cuesReached(EVENTS, -3, 99)).toEqual(["dice", "rent", "dice"]);
    expect(cuesReached([], 0, 1)).toEqual([]);
  });

  it("finds the roll and the Rent in a real Roll's events", () => {
    expect(cuesReached(ROLL(), 0, 1)).toEqual(["dice"]);
    expect(cuesReached(ROLL(), 1, 2)).toEqual([]);
    expect(cuesReached(ROLL(), 2, ROLL().length)).toEqual(["rent"]);
  });
});
