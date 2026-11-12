import type { GameEvent } from "@universum/rules";
import { describe, expect, it } from "vitest";
import { EVENT_PRESENTATION } from "#playback/presentation.ts";
import { CUES, EVENT_CUES, cuesReached, type CueName } from "#sound/cues.ts";
import { ROLL } from "./playback-fixtures.ts";

// The cue table (spec #178): one exhaustive row per event type saying which
// sound it starts, or an explicit silence. A new event type fails to compile
// until it has a row, and this test fails until the row is pinned here.

/** Every event's cue: the dice on a roll, silence everywhere else for now. */
const CUED = {
  DiceRolled: "dice",
  Moved: "none",
  RoundBonusPaid: "none",
  LevelBought: "none",
  MuseumBought: "none",
  BoughtOut: "none",
  OfferDeclined: "none",
  RentPaid: "none",
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
  it("lists every event type with the dice on a roll and silence everywhere else", () => {
    expect(EVENT_CUES).toEqual(CUED);
    // The presentation table is exhaustive too, so the two agree on the set.
    expect(Object.keys(EVENT_CUES).sort()).toEqual(Object.keys(EVENT_PRESENTATION).sort());
  });

  it("names the effect file of every cue", () => {
    expect(CUES.dice).toContain("dice.mp3");
  });
});

describe("cuesReached", () => {
  it("returns the cues of the events in the half-open range, in order", () => {
    expect(cuesReached(EVENTS, 0, EVENTS.length)).toEqual(["dice", "dice"]);
    expect(cuesReached(EVENTS, 1, 2)).toEqual(["dice"]);
    expect(cuesReached(EVENTS, 2, 4)).toEqual(["dice"]);
  });

  it("returns nothing for a range of silent events or an empty range", () => {
    expect(cuesReached(EVENTS, 0, 1)).toEqual([]);
    expect(cuesReached(EVENTS, 2, 3)).toEqual([]);
    expect(cuesReached(EVENTS, 4, 4)).toEqual([]);
  });

  it("clamps a range to the events it has", () => {
    expect(cuesReached(EVENTS, -3, 99)).toEqual(["dice", "dice"]);
    expect(cuesReached([], 0, 1)).toEqual([]);
  });

  it("finds the roll at the head of a real Roll's events", () => {
    expect(cuesReached(ROLL(), 0, 1)).toEqual(["dice"]);
    expect(cuesReached(ROLL(), 1, ROLL().length)).toEqual([]);
  });
});
