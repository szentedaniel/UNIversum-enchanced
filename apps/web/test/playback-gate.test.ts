import type { GameEvent } from "@universum/rules";
import { PLAYBACK_MS } from "@universum/rules/playback";
import { describe, expect, it } from "vitest";
import { decisionOpensAt, type TimedPush } from "#playback/playback-store.ts";

// The decision gate (ADR-0004): the controls open when the local Playback of
// the push's events has finished AND the server's `actsAfter` has passed, on
// this client's clock. With no events (first view, reconnect, reload) only
// `actsAfter` applies.

const ROLL: GameEvent[] = [
  { type: "DiceRolled", player: "p1", dice: [3, 4] },
  { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
  { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
];

const ROLL_MS = PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved + PLAYBACK_MS.RentPaid;

const push = (patch: Partial<TimedPush> = {}): TimedPush => ({
  view: { actsAfter: 10_000 },
  events: ROLL,
  receivedAt: 1_000,
  clockOffset: 0,
  ...patch,
});

describe("the decision gate", () => {
  it("ADR-0004: with no events only actsAfter applies, on the server's clock", () => {
    expect(decisionOpensAt(push({ events: [], receivedAt: 1_000 }))).toBe(10_000);
    // A client 500 ms behind the server: actsAfter is 9 500 ms on its own clock.
    expect(decisionOpensAt(push({ events: [], clockOffset: 500 }))).toBe(9_500);
    expect(decisionOpensAt(push({ events: [], clockOffset: -250 }))).toBe(10_250);
  });

  it("ADR-0004: the local Playback ends at the push's arrival plus its events", () => {
    expect(decisionOpensAt(push({ view: { actsAfter: 0 } }))).toBe(1_000 + ROLL_MS);
  });

  it("ADR-0004: both must have passed, so the later of the two opens the decision", () => {
    // The server waited 5 s, the local Playback is ~2 s: the server's clock wins.
    expect(decisionOpensAt(push({ view: { actsAfter: 6_000 } }))).toBe(6_000);
    // The server's wait is already over: the local Playback keeps the controls shut.
    expect(decisionOpensAt(push({ view: { actsAfter: 1_500 } }))).toBe(1_000 + ROLL_MS);
  });
});
