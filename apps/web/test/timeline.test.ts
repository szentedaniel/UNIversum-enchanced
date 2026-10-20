import type { GameEvent } from "@universum/rules";
import { PLAYBACK_MS, playbackOf } from "@universum/rules/playback";
import { describe, expect, it } from "vitest";
import { timelineOf, type PlaybackStep } from "#playback/timeline.ts";
import { cueAt, toastCues } from "#playback/toast.ts";

// The local Playback (ADR-0004): one push's events become ordered steps, each
// with its start offset and duration from the rules constants. The Board's
// animation queue and the status row's toast both play these steps, so their
// order and timing are the same on every screen.

const total = (steps: readonly PlaybackStep[]): number =>
  steps.reduce((sum, step) => sum + step.durationMs, 0);

/** A Roll, the walk, the Rent it stopped at and the Turn passing. */
const ROLL = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [3, 4] },
  { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
  { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A Roll from the Field before Start: the walk pays the Round bonus on the way. */
const PAST_START = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [2, 2] },
  { type: "Moved", player: "p1", from: 30, to: 2, steps: 4 },
  { type: "RoundBonusPaid", player: "p1", amount: 200_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A Roll onto Chance: the card is drawn, then its money arrives. */
const CHANCE = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [1, 1] },
  { type: "Moved", player: "p1", from: 12, to: 14, steps: 2 },
  { type: "CardDrawn", player: "p1", card: "scholarship" },
  { type: "ChanceMoneyReceived", player: "p1", amount: 300_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A timeout: the timeout, the Auto-sell it forced and the penalty. */
const TIMEOUT = (): GameEvent[] => [
  { type: "TimedOut", player: "p1" },
  { type: "FieldsSold", player: "p1", fields: [1], amount: 100_000, auto: true },
  { type: "TimeoutPenaltyPaid", player: "p1", amount: 50_000 },
  { type: "TurnPassed", player: "p2", turn: 3 },
];

describe("the Playback timeline", () => {
  it("ADR-0004: a Roll is the dice, the walk hop by hop, the Rent and the Turn passing", () => {
    const steps = timelineOf(ROLL());
    const walkMs = 7 * PLAYBACK_MS.Moved;

    expect(steps.map((step) => step.event.type)).toEqual([
      "DiceRolled",
      "Moved",
      "RentPaid",
      "TurnPassed",
    ]);
    expect(steps.map((step) => step.startMs)).toEqual([
      0,
      PLAYBACK_MS.DiceRolled,
      PLAYBACK_MS.DiceRolled + walkMs,
      PLAYBACK_MS.DiceRolled + walkMs + PLAYBACK_MS.RentPaid,
    ]);
    expect(steps.map((step) => step.durationMs)).toEqual([
      PLAYBACK_MS.DiceRolled,
      walkMs,
      PLAYBACK_MS.RentPaid,
      0,
    ]);
    // The dice have their own layer, the card its own; a walk shows only on the Board.
    expect(steps.map((step) => step.kind)).toEqual(["dice", "none", "toast", "none"]);
    expect(total(steps)).toBe(playbackOf(ROLL()));
  });

  it("ADR-0004: the Round bonus comes after the hop that passed Start", () => {
    const steps = timelineOf(PAST_START());
    const dice = steps[0];
    const walk = steps[1];
    const bonus = steps.find((step) => step.event.type === "RoundBonusPaid");

    if (!dice || !walk || !bonus) throw new Error("the timeline lost an event");
    expect(steps.map((step) => step.event.type)).toEqual([
      "DiceRolled",
      "Moved",
      "RoundBonusPaid",
      "TurnPassed",
    ]);
    expect(bonus.startMs).toBe(dice.durationMs + walk.durationMs);
    expect(bonus.startMs).toBe(PLAYBACK_MS.DiceRolled + 4 * PLAYBACK_MS.Moved);
    expect(bonus.kind).toBe("toast");
    expect(total(steps)).toBe(playbackOf(PAST_START()));
  });

  it("ADR-0004: a Chance card lasts its 7 s and its money follows the card", () => {
    const steps = timelineOf(CHANCE());
    const card = steps.find((step) => step.event.type === "CardDrawn");
    const money = steps.find((step) => step.event.type === "ChanceMoneyReceived");

    if (!card || !money) throw new Error("the timeline lost the card or its money");
    expect(card.kind).toBe("card");
    expect(card.durationMs).toBe(PLAYBACK_MS.CardDrawn);
    expect(card.durationMs).toBe(7_000);
    expect(money.startMs).toBe(card.startMs + card.durationMs);
    expect(money.kind).toBe("toast");
    expect(total(steps)).toBe(playbackOf(CHANCE()));
  });

  it("ADR-0004: a timeout plays the timeout, the Auto-sell and the penalty in order", () => {
    const steps = timelineOf(TIMEOUT());

    expect(steps.map((step) => step.event.type)).toEqual([
      "TimedOut",
      "FieldsSold",
      "TimeoutPenaltyPaid",
      "TurnPassed",
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["toast", "toast", "toast", "none"]);
    expect(steps.map((step) => step.startMs)).toEqual([
      0,
      PLAYBACK_MS.TimedOut,
      PLAYBACK_MS.TimedOut + PLAYBACK_MS.FieldsSold,
      PLAYBACK_MS.TimedOut + PLAYBACK_MS.FieldsSold + PLAYBACK_MS.TimeoutPenaltyPaid,
    ]);
    expect(total(steps)).toBe(playbackOf(TIMEOUT()));
  });

  it("ADR-0004: the steps always add up to the Playback the server waited for", () => {
    for (const events of [
      ROLL(),
      PAST_START(),
      CHANCE(),
      TIMEOUT(),
      [],
      [{ type: "OfferDeclined", player: "p1", field: 3 } satisfies GameEvent],
    ]) {
      expect(total(timelineOf(events))).toBe(playbackOf(events));
    }
  });

  it("ADR-0004: a zero-length event still gets a step, starting where the next one does", () => {
    const steps = timelineOf([
      { type: "OfferDeclined", player: "p1", field: 3 } satisfies GameEvent,
      { type: "DiceRolled", player: "p2", dice: [1, 2] } satisfies GameEvent,
    ]);

    expect(steps.map((step) => [step.event.type, step.startMs, step.durationMs])).toEqual([
      ["OfferDeclined", 0, 0],
      ["DiceRolled", 0, PLAYBACK_MS.DiceRolled],
    ]);
  });
});

const textOf = (event: GameEvent): string | null => (event.type === "Moved" ? null : event.type);

describe("the toast's steps", () => {
  it("ADR-0004: the toast shows each step that has text, in order, from its start", () => {
    const steps = timelineOf(ROLL());
    const cues = toastCues(steps, textOf);
    const walkMs = 7 * PLAYBACK_MS.Moved;

    // The walk has no text, so the dice stay up while the pawn moves.
    expect(cues.map((cue) => [cue.text, cue.startMs])).toEqual([
      ["DiceRolled", 0],
      ["RentPaid", PLAYBACK_MS.DiceRolled + walkMs],
    ]);
    expect(cueAt(cues, 0)?.text).toBe("DiceRolled");
    expect(cueAt(cues, PLAYBACK_MS.DiceRolled + walkMs - 1)?.text).toBe("DiceRolled");
    expect(cueAt(cues, PLAYBACK_MS.DiceRolled + walkMs)?.text).toBe("RentPaid");
    expect(cueAt(cues, 600_000)?.text).toBe("RentPaid");
  });

  it("ADR-0004: an event with no text leaves the previous one up", () => {
    const events: GameEvent[] = [
      { type: "DiceRolled", player: "p1", dice: [1, 1] },
      { type: "DoublerPlaced", player: "p1", field: 16, count: 1 },
    ];
    const cues = toastCues(timelineOf(events), (event) =>
      event.type === "DoublerPlaced" ? null : event.type,
    );

    expect(cues.map((cue) => cue.text)).toEqual(["DiceRolled"]);
  });

  it("ADR-0004: a Playback with no events has no toast", () => {
    expect(toastCues([], textOf)).toEqual([]);
    expect(cueAt([], 0)).toBeNull();
  });
});
