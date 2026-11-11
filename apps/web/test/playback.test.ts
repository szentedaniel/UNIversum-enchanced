import type { GameEvent, Seed } from "@universum/rules";
import { apply, publicView, setupGame } from "@universum/rules";
import { PLAYBACK_MS, playbackOf } from "@universum/rules/playback";
import { describe, expect, it } from "vitest";
import type { Frame, PlaybackPush, TurnLabel } from "#playback/playback.ts";
import { playbackOfPush } from "#playback/playback.ts";
import { stepAt, timelineOf, type PlaybackStep } from "#playback/timeline.ts";
import {
  CHANCE,
  CHANCE_CHARGE,
  fieldOf,
  PAST_START,
  playersWithCash,
  revealWithCash,
  ROLL,
  TIMEOUT,
  viewOf,
} from "./playback-fixtures.ts";

// The Playback core (ADR-0004, spec #63): one push's events become one clock,
// on this client's time. The timeline gives each event its start and duration;
// the core answers what the screen shows at any instant — the dice or the
// Chance card, the toast's latest line, the Decision gate, the held Turn label
// and each pawn's Field position. No browser, no timers, no Pixi.

const total = (steps: readonly PlaybackStep[]): number =>
  steps.reduce((sum, step) => sum + step.durationMs, 0);

/** A game started at a fixed time with fixed dice, as the rules tests do. */
const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SEED: Seed = [0x1234_5678, -0x2345_6789, 0x0bad_f00d, 0x7777_1111];

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

  it("ADR-0004: after a Chance charge, its forced Sale follows the card in order", () => {
    const steps = timelineOf(CHANCE_CHARGE());
    const card = steps.find((step) => step.event.type === "CardDrawn");
    const charge = steps.find((step) => step.event.type === "ChanceChargePaid");
    const sale = steps.find((step) => step.event.type === "FieldsSold");

    if (!card || !charge || !sale) throw new Error("the timeline lost the charge or its Sale");
    expect(steps.map((step) => step.kind)).toEqual([
      "dice",
      "none",
      "card",
      "toast",
      "toast",
      "none",
    ]);
    expect(charge.startMs).toBe(card.startMs + card.durationMs);
    expect(sale.startMs).toBe(charge.startMs + charge.durationMs);
    expect(total(steps)).toBe(playbackOf(CHANCE_CHARGE()));
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
      CHANCE_CHARGE(),
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

describe("the Playback playhead", () => {
  it("ADR-0004: the dice show for their own step only, before the walk", () => {
    const steps = timelineOf(ROLL());
    const walkMs = 7 * PLAYBACK_MS.Moved;

    expect(stepAt(steps, 0)?.kind).toBe("dice");
    expect(stepAt(steps, PLAYBACK_MS.DiceRolled - 1)?.kind).toBe("dice");
    expect(stepAt(steps, PLAYBACK_MS.DiceRolled)?.event.type).toBe("Moved");
    expect(stepAt(steps, PLAYBACK_MS.DiceRolled + walkMs - 1)?.event.type).toBe("Moved");
    expect(stepAt(steps, PLAYBACK_MS.DiceRolled + walkMs)?.event.type).toBe("RentPaid");
    expect(stepAt(steps, playbackOf(ROLL()) - 1)?.event.type).toBe("RentPaid");
    expect(stepAt(steps, playbackOf(ROLL()))).toBeNull();
  });

  it("ADR-0004: the card is the current step for its 7 s, the effect after it", () => {
    const steps = timelineOf(CHANCE_CHARGE());
    const card = steps.find((step) => step.kind === "card");

    if (!card) throw new Error("the timeline lost the card");
    expect(stepAt(steps, card.startMs)?.kind).toBe("card");
    expect(stepAt(steps, card.startMs + card.durationMs - 1)?.kind).toBe("card");
    expect(stepAt(steps, card.startMs + card.durationMs)?.event.type).toBe("ChanceChargePaid");
  });

  it("ADR-0004: a zero-length step is never current, and a finished Playback shows nothing", () => {
    const steps = timelineOf([
      { type: "OfferDeclined", player: "p1", field: 3 } satisfies GameEvent,
      { type: "DiceRolled", player: "p2", dice: [1, 2] } satisfies GameEvent,
    ]);

    expect(stepAt(steps, 0)?.event.type).toBe("DiceRolled");
    expect(stepAt(steps, PLAYBACK_MS.DiceRolled)).toBeNull();
    expect(stepAt([], 0)).toBeNull();
  });
});

// ------------------------------------------------------------ the core

const pushOf = (events: GameEvent[], patch: Partial<PlaybackPush> = {}): PlaybackPush => ({
  seq: 1,
  view: viewOf(),
  events,
  reveals: [],
  receivedAt: 1_000,
  clockOffset: 0,
  ...patch,
});

const pawnAt = (frame: Frame, id: string) => frame.pawns.get(id);

const noEventsOpensAt = (patch: Partial<PlaybackPush> = {}) =>
  playbackOfPush(pushOf([], { view: viewOf(undefined, { actsAfter: 10_000 }), ...patch })).opensAt;

const PREVIOUS: TurnLabel = { turn: 1, currentPlayer: "p2" };
const CURRENT: TurnLabel = { turn: 2, currentPlayer: "p1" };

describe("the Playback core's opening time", () => {
  it("ADR-0004: with no events only actsAfter applies, on the server's clock", () => {
    expect(noEventsOpensAt({ receivedAt: 1_000 })).toBe(10_000);
    // A client 500 ms behind the server: actsAfter is 9 500 ms on its own clock.
    expect(noEventsOpensAt({ clockOffset: 500 })).toBe(9_500);
    expect(noEventsOpensAt({ clockOffset: -250 })).toBe(10_250);
  });

  it("ADR-0004: the local Playback ends at the push's arrival plus its events", () => {
    expect(
      playbackOfPush(pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 0 }) })).opensAt,
    ).toBe(1_000 + playbackOf(ROLL()));
  });

  it("ADR-0004: both must have passed, so the later of the two opens the decision", () => {
    // The server waited 5 s, the local Playback is ~2 s: the server's clock wins.
    expect(
      playbackOfPush(pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 6_000 }) })).opensAt,
    ).toBe(6_000);
    // The server's wait has already ended: the local Playback keeps the controls shut.
    expect(
      playbackOfPush(pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 1_500 }) })).opensAt,
    ).toBe(1_000 + playbackOf(ROLL()));
  });

  it("ADR-0004: the boundaries are every step's end and the opening, once each", () => {
    const playback = playbackOfPush(
      pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 5_000 }) }),
    );

    // The dice, the walk, the Rent, the zero-length Turn passing, and the opening.
    expect(playback.opensAt).toBe(5_000);
    expect(playback.boundaries).toEqual([1_450, 2_570, 3_170, 5_000]);
  });

  it("ADR-0004: a push with no events has one boundary, its opening", () => {
    const playback = playbackOfPush(
      pushOf([], { view: viewOf(undefined, { actsAfter: 9_000 }), clockOffset: 500 }),
    );

    expect(playback.boundaries).toEqual([8_500]);
  });
});

describe("the Playback core's overlay", () => {
  it("ADR-0004: the dice show for their own step, then nothing until the card", () => {
    const playback = playbackOfPush(pushOf(ROLL()));

    expect(playback.frameAt(999).overlay).toBeNull();
    expect(playback.frameAt(1_000).overlay).toEqual({
      kind: "dice",
      event: { type: "DiceRolled", player: "p1", dice: [3, 4] },
      startMs: 0,
      durationMs: PLAYBACK_MS.DiceRolled,
    });
    expect(playback.frameAt(1_449).overlay?.kind).toBe("dice");
    expect(playback.frameAt(1_450).overlay).toBeNull();
    expect(playback.frameAt(3_169).overlay).toBeNull();
    expect(playback.frameAt(3_170).overlay).toBeNull();
  });

  it("ADR-0004: a drawn card shows for its 7 s with its own start, then its effect", () => {
    const playback = playbackOfPush(pushOf(CHANCE()));
    const card = timelineOf(CHANCE()).find((step) => step.kind === "card");

    if (!card) throw new Error("the timeline lost the card");
    const start = 1_000 + card.startMs;
    expect(playback.frameAt(start - 1).overlay).toBeNull();
    expect(playback.frameAt(start).overlay).toMatchObject({
      kind: "card",
      event: { type: "CardDrawn", card: "scholarship" },
      startMs: card.startMs,
    });
    expect(playback.frameAt(start + card.durationMs - 1).overlay?.kind).toBe("card");
    expect(playback.frameAt(start + card.durationMs).overlay).toBeNull();
  });
});

describe("the Playback core's toast", () => {
  it("ADR-0004: the toast shows each step that has text, in order, from its start", () => {
    const playback = playbackOfPush(pushOf(ROLL()));
    const walkEnd = 1_000 + PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved;

    // The walk has no text, so the dice stay up while the pawn moves.
    expect(playback.frameAt(1_000).toast?.event.type).toBe("DiceRolled");
    expect(playback.frameAt(1_000).toast?.text.trim()).not.toBe("");
    expect(playback.frameAt(walkEnd - 1).toast?.event.type).toBe("DiceRolled");
    expect(playback.frameAt(walkEnd).toast?.event.type).toBe("RentPaid");
    expect(playback.frameAt(600_000).toast?.event.type).toBe("RentPaid");
  });

  it("ADR-0004: a notice carries the accent tone, a routine event the plain one", () => {
    const playback = playbackOfPush(pushOf(ROLL()));
    const walkEnd = 1_000 + PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved;

    expect(playback.frameAt(1_000).toast?.tone).toBe("routine");
    expect(playback.frameAt(walkEnd).toast?.tone).toBe("notice");
  });

  it("ADR-0004: an event with no text leaves the previous one up", () => {
    const playback = playbackOfPush(
      pushOf([
        { type: "DiceRolled", player: "p1", dice: [1, 1] },
        { type: "DoublerPlaced", player: "p1", field: 16, count: 1 },
        { type: "TurnPassed", player: "p2", turn: 2 },
      ]),
    );

    expect(playback.frameAt(1_000 + PLAYBACK_MS.DiceRolled).toast?.event.type).toBe("DiceRolled");
    expect(playback.frameAt(600_000).toast?.event.type).toBe("DiceRolled");
  });

  it("ADR-0004: a Playback with no events has no toast", () => {
    expect(playbackOfPush(pushOf([])).frameAt(1_000).toast).toBeNull();
  });
});

describe("the Playback core's gate and held Turn", () => {
  it("ADR-0004: the gate opens at opensAt, not a millisecond before", () => {
    const playback = playbackOfPush(
      pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 5_000 }) }),
    );

    expect(playback.frameAt(4_999).gateOpen).toBe(false);
    expect(playback.frameAt(5_000).gateOpen).toBe(true);
  });

  it("ADR-0004: keeps the previous Turn for the Playback, then switches with the controls", () => {
    const playback = playbackOfPush(
      pushOf(ROLL(), { view: viewOf(undefined, { actsAfter: 5_000 }) }),
      PREVIOUS,
    );

    expect(playback.frameAt(1_000).shownTurn).toBe(PREVIOUS);
    expect(playback.frameAt(4_999).shownTurn).toBe(PREVIOUS);
    expect(playback.frameAt(5_000).shownTurn).toEqual(CURRENT);
  });

  it("ADR-0004: with no previous view, or no local Playback, shows the current Turn at once", () => {
    expect(playbackOfPush(pushOf(ROLL()), null).frameAt(1_000).shownTurn).toEqual(CURRENT);
    expect(playbackOfPush(pushOf([]), PREVIOUS).frameAt(1_000).shownTurn).toEqual(CURRENT);
  });

  it("ADR-0004: the frame carries the push's identity and view", () => {
    const view = viewOf();
    const frame = playbackOfPush(pushOf(ROLL(), { seq: 7, view })).frameAt(1_000);

    expect(frame.seq).toBe(7);
    expect(frame.view).toBe(view);
  });
});

describe("the Playback core's pawns", () => {
  it("ADR-0004: before the first hop a pawn stands where its Moved starts", () => {
    const playback = playbackOfPush(pushOf(ROLL()));

    expect(pawnAt(playback.frameAt(1_000), "p1")).toEqual({ field: 1, toward: null, progress: 0 });
    expect(pawnAt(playback.frameAt(1_449), "p1")).toEqual({ field: 1, toward: null, progress: 0 });
  });

  it("ADR-0004: a walk is interpolated hop by hop, with the walking Player named", () => {
    const playback = playbackOfPush(pushOf(ROLL()));
    const start = 1_000 + PLAYBACK_MS.DiceRolled;

    expect(playback.frameAt(start - 1).walking).toBeNull();
    expect(playback.frameAt(start).walking).toBe("p1");
    expect(pawnAt(playback.frameAt(start), "p1")).toEqual({ field: 1, toward: 2, progress: 0 });
    // 3.5 hops into a 7-Field walk from Field 1.
    expect(pawnAt(playback.frameAt(start + 7 * PLAYBACK_MS.Moved * 0.5), "p1")).toEqual({
      field: 4,
      toward: 5,
      progress: 0.5,
    });
    const last = pawnAt(playback.frameAt(start + 7 * PLAYBACK_MS.Moved - 1), "p1");
    expect(last?.field).toBe(7);
    expect(last?.toward).toBe(8);
    expect(last?.progress).toBeCloseTo(1 - 1 / PLAYBACK_MS.Moved);
    expect(playback.frameAt(start + 7 * PLAYBACK_MS.Moved).walking).toBeNull();
    expect(pawnAt(playback.frameAt(start + 7 * PLAYBACK_MS.Moved), "p1")).toEqual({
      field: 8,
      toward: null,
      progress: 0,
    });
  });

  it("ADR-0004: a hop across Start wraps at Field 31, then reaches the final view", () => {
    const playback = playbackOfPush(pushOf(PAST_START(), { view: viewOf({ p1: 2, p2: 17 }) }));
    const start = 1_000 + PLAYBACK_MS.DiceRolled;
    const hop = PLAYBACK_MS.Moved;

    // Four hops from Field 30: 31, 0, 1, 2.
    expect(pawnAt(playback.frameAt(start), "p1")).toEqual({ field: 30, toward: 31, progress: 0 });
    expect(pawnAt(playback.frameAt(start + hop + hop / 2), "p1")).toEqual({
      field: 31,
      toward: 0,
      progress: 0.5,
    });
    expect(pawnAt(playback.frameAt(start + 2 * hop), "p1")).toEqual({
      field: 0,
      toward: 1,
      progress: 0,
    });
    expect(pawnAt(playback.frameAt(start + 4 * hop), "p1")).toEqual({
      field: 2,
      toward: null,
      progress: 0,
    });
    expect(pawnAt(playback.frameAt(600_000), "p1")).toEqual({
      field: 2,
      toward: null,
      progress: 0,
    });
  });

  it("ADR-0004: between two hops the pawn stands on the last `to`", () => {
    const playback = playbackOfPush(
      pushOf(
        [
          { type: "Moved", player: "p1", from: 1, to: 3, steps: 2 },
          { type: "RentPaid", player: "p1", owner: "p2", field: 3, amount: 50_000 },
          { type: "Moved", player: "p1", from: 3, to: 6, steps: 3 },
        ],
        { view: viewOf({ p1: 6, p2: 17 }) },
      ),
    );

    expect(pawnAt(playback.frameAt(1_000 + 2 * PLAYBACK_MS.Moved), "p1")).toEqual({
      field: 3,
      toward: null,
      progress: 0,
    });
    expect(playback.frameAt(1_000 + 2 * PLAYBACK_MS.Moved).walking).toBeNull();
    // The next hop starts there: still Field 3, now heading for 4.
    expect(
      pawnAt(playback.frameAt(1_000 + 2 * PLAYBACK_MS.Moved + PLAYBACK_MS.RentPaid), "p1"),
    ).toEqual({ field: 3, toward: 4, progress: 0 });
    expect(playback.frameAt(1_000 + 2 * PLAYBACK_MS.Moved + PLAYBACK_MS.RentPaid).walking).toBe(
      "p1",
    );
  });

  it("ADR-0004: a Player who did not move, and every Player after the Playback, is at the view", () => {
    const playback = playbackOfPush(pushOf([{ type: "TimedOut", player: "p1" }]));

    expect(pawnAt(playback.frameAt(1_000), "p1")).toEqual({ field: 8, toward: null, progress: 0 });
    expect(pawnAt(playback.frameAt(1_000), "p2")).toEqual({ field: 17, toward: null, progress: 0 });
    expect(playback.frameAt(1_000).walking).toBeNull();
  });

  it("ADR-0004: a push with no events stands every pawn at its view", () => {
    const frame = playbackOfPush(
      pushOf([], { view: viewOf({ p1: 3, p2: 20 }, { actsAfter: 5_000 }) }),
    ).frameAt(1_000);

    expect(pawnAt(frame, "p1")).toEqual({ field: 3, toward: null, progress: 0 });
    expect(pawnAt(frame, "p2")).toEqual({ field: 20, toward: null, progress: 0 });
    expect(frame.walking).toBeNull();
  });
});

// ------------------------------------------------------------ the reveals

const cashOf = (frame: Frame, id: string): number => {
  const found = frame.view.players.find((player) => player.id === id);
  if (!found) throw new Error(`no Player ${id} in the frame`);
  return found.cash;
};

describe("the Playback core's reveals", () => {
  it("ADR-0005: each step shows its own reveal, the push's view coming back once the Playback ends", () => {
    const view = viewOf(undefined, { players: playersWithCash({ p1: 50_000, p2: 150_000 }) });
    const playback = playbackOfPush(
      pushOf(ROLL(), {
        view,
        reveals: [
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
        ],
      }),
    );
    const walkEnd = 1_000 + PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved;

    // The dice and the walk: the Rent has not been paid yet.
    expect(cashOf(playback.frameAt(1_000), "p1")).toBe(100_000);
    expect(cashOf(playback.frameAt(walkEnd - 1), "p1")).toBe(100_000);
    // The Rent step: the payer's cash drops and the owner's rises.
    expect(cashOf(playback.frameAt(walkEnd), "p1")).toBe(50_000);
    expect(cashOf(playback.frameAt(walkEnd), "p2")).toBe(150_000);
    // The zero-length Turn passing keeps the last step's reveal up.
    expect(cashOf(playback.frameAt(1_000 + playbackOf(ROLL()) - 1), "p1")).toBe(50_000);
    // Once the Playback has run out the frame is the push's own view.
    expect(playback.frameAt(1_000 + playbackOf(ROLL())).view).toBe(view);
    expect(cashOf(playback.frameAt(600_000), "p1")).toBe(50_000);
  });

  it("ADR-0005: a zero-length step takes the next step's start, and the Playback's end is the push's view", () => {
    const view = viewOf(undefined, { players: playersWithCash({ p1: 50_000, p2: 150_000 }) });
    const playback = playbackOfPush(
      pushOf(
        [
          { type: "OfferDeclined", player: "p1", field: 3 },
          { type: "DiceRolled", player: "p2", dice: [1, 2] },
          { type: "TurnPassed", player: "p1", turn: 2 },
        ],
        {
          view,
          reveals: [
            revealWithCash({ p1: 1_000, p2: 100_000 }),
            revealWithCash({ p1: 2_000, p2: 100_000 }),
            revealWithCash({ p1: 3_000, p2: 100_000 }),
          ],
        },
      ),
    );
    const playbackEnd =
      1_000 +
      playbackOf([
        { type: "OfferDeclined", player: "p1", field: 3 },
        { type: "DiceRolled", player: "p2", dice: [1, 2] },
        { type: "TurnPassed", player: "p1", turn: 2 },
      ]);

    // The declined offer starts where the dice do: the latest started step's reveal shows.
    expect(cashOf(playback.frameAt(1_000), "p1")).toBe(2_000);
    expect(playback.frameAt(playbackEnd - 1).view).toBe(playback.frameAt(1_000).view);
    // The trailing Turn passing starts where the Playback ends, so its reveal never
    // shows: the push's own view takes over. Its toast stays, as the cue rule has it.
    expect(playback.frameAt(playbackEnd).view).toBe(view);
    expect(playback.frameAt(playbackEnd).toast?.event.type).toBe("DiceRolled");
  });

  it("ADR-0005: the view is the same object within a step and a new one when the step changes", () => {
    const playback = playbackOfPush(
      pushOf(ROLL(), {
        reveals: [
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
        ],
      }),
    );
    const walkStart = 1_000 + PLAYBACK_MS.DiceRolled;
    const walkEnd = walkStart + 7 * PLAYBACK_MS.Moved;

    const first = playback.frameAt(walkStart).view;
    expect(playback.frameAt(walkStart + 1).view).toBe(first);
    expect(playback.frameAt(walkEnd - 1).view).toBe(first);
    expect(playback.frameAt(walkEnd).view).not.toBe(first);
    // The step's merged view is built once, not per frame.
    expect(playback.frameAt(walkEnd).view).toBe(playback.frameAt(walkEnd + 1).view);
  });

  it("ADR-0005: equal reveals keep the previous step's view object, a changed one gets a new one", () => {
    const playback = playbackOfPush(
      pushOf(ROLL(), {
        reveals: [
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 100_000, p2: 100_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
          revealWithCash({ p1: 50_000, p2: 150_000 }),
        ],
      }),
    );
    const walkStart = 1_000 + PLAYBACK_MS.DiceRolled;
    const walkEnd = walkStart + 7 * PLAYBACK_MS.Moved;

    // The dice and the walk reveal the same board: one object, so the Board skips the redraw.
    const dice = playback.frameAt(1_000).view;
    expect(playback.frameAt(walkStart).view).toBe(dice);
    // The Rent changes the board: a new object, kept through the zero-length Turn passing.
    const rent = playback.frameAt(walkEnd).view;
    expect(rent).not.toBe(dice);
    expect(playback.frameAt(walkEnd + PLAYBACK_MS.RentPaid - 1).view).toBe(rent);
  });

  it("ADR-0005: a reveal that only moved a pawn keeps the previous step's view object", () => {
    // A real Roll: the DiceRolled reveal is the board before the move, the Moved
    // one the board after it, so they differ in a Player's position and nowhere
    // else. The merged views are identical, so the walk must not redraw the Board.
    const state = setupGame({
      seats: [
        { playerId: "p1", name: { adjective: "adj0", noun: "noun0" } },
        { playerId: "p2", name: { adjective: "adj1", noun: "noun1" } },
      ],
      settings: { maxPlayers: 2, minuteLimit: 50, startingCash: 2_500_000, roundBonus: 250_000 },
      seed: SEED,
      now: T0,
    });
    const rolled = apply(
      state,
      { type: "Roll", turn: state.turn },
      { actor: state.currentPlayer, now: Math.max(T0, state.actsAfter) },
    );
    if ("code" in rolled) throw new Error(`the Roll was refused: ${rolled.code}`);

    const diceIndex = rolled.events.findIndex((event) => event.type === "DiceRolled");
    const movedIndex = rolled.events.findIndex((event) => event.type === "Moved");
    const before = rolled.reveals[diceIndex];
    const moved = rolled.reveals[movedIndex];

    if (!before || !moved) throw new Error("the Roll lost a reveal");
    expect(movedIndex).toBe(diceIndex + 1);
    expect(
      moved.players.map((player) => [player.id, player.cash, player.wealth, player.bankrupt]),
    ).toEqual(
      before.players.map((player) => [player.id, player.cash, player.wealth, player.bankrupt]),
    );
    expect(moved.players.map((player) => player.position)).not.toEqual(
      before.players.map((player) => player.position),
    );

    const view = publicView(rolled.state);
    const playback = playbackOfPush(pushOf(rolled.events, { view, reveals: rolled.reveals }));
    const walkStart = 1_000 + PLAYBACK_MS.DiceRolled;

    expect(playback.frameAt(walkStart).view).toBe(playback.frameAt(1_000).view);
    // The merged view still shows the pawns where the final view has them.
    expect(playback.frameAt(walkStart).view.players.map((player) => player.position)).toEqual(
      view.players.map((player) => player.position),
    );
  });

  it("ADR-0005: pawns and everything behind the Decision gate stay the final view's", () => {
    const view = viewOf(undefined, {
      turn: 4,
      currentPlayer: "p2",
      actsAfter: 9_000,
      endsAt: 42_000,
      phase: { kind: "selling", shortfall: 10_000, resume: { kind: "tax", amount: 20_000 } },
      autoSell: [3],
      standings: null,
    });
    const reveal = revealWithCash(
      { p1: 100_000, p2: 100_000 },
      { doubler: { field: 3, count: 2 }, fields: [fieldOf({ owner: "p2", level: 1 })] },
    );
    const frame = playbackOfPush(pushOf(ROLL(), { view, reveals: [reveal] })).frameAt(1_000);

    // The reveal's pawns are one Field behind; the frame keeps the final positions.
    expect(frame.view.players.map((player) => player.position)).toEqual([8, 17]);
    expect(frame.view.turn).toBe(4);
    expect(frame.view.currentPlayer).toBe("p2");
    expect(frame.view.phase).toEqual(view.phase);
    expect(frame.view.actsAfter).toBe(9_000);
    expect(frame.view.endsAt).toBe(42_000);
    expect(frame.view.autoSell).toEqual([3]);
    expect(frame.view.standings).toBeNull();
    // The Doubler and the Fields are the reveal's.
    expect(frame.view.doubler).toEqual({ field: 3, count: 2 });
    expect(frame.view.fields).toBe(reveal.fields);
  });

  it("ADR-0005: a push with no reveals, or a step without one, shows the final view", () => {
    const view = viewOf();

    expect(playbackOfPush(pushOf(ROLL(), { view, reveals: [] })).frameAt(1_000).view).toBe(view);
    expect(playbackOfPush(pushOf([], { view })).frameAt(1_000).view).toBe(view);

    const partial = playbackOfPush(
      pushOf(ROLL(), { view, reveals: [revealWithCash({ p1: 1_000, p2: 100_000 })] }),
    );
    expect(cashOf(partial.frameAt(1_000), "p1")).toBe(1_000);
    // The walk has no reveal: the final view shows instead of the last one.
    expect(partial.frameAt(1_000 + PLAYBACK_MS.DiceRolled).view).toBe(view);
  });
});
