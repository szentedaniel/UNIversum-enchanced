import { describe, expect, it } from "vitest";
import {
  apply,
  isRejection,
  PLAYBACK_MS,
  playbackOf,
  publicView,
  SYSTEM,
  TURN_LIMIT_MS,
  TURN_SLACK_MS,
  type GameEvent,
  type GameState,
} from "#index.ts";
import {
  accept,
  deadlineOf,
  newGame,
  reject,
  roll,
  rollOnto,
  T0,
  withField,
  withPlayer,
} from "./helpers.ts";

const TAX = 30;
const CHANCE = 14;
const VESZPREM = 1;

const timeOut = (state: GameState, now = deadlineOf(state)) =>
  accept(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, now);

/** A Player intent from the current Seat, for a Turn it may roll in. */
const nextRoll = (state: GameState) => ({
  type: "Roll" as const,
  turn: state.turn,
});

describe("the Playback table", () => {
  it("ADR-0004: the Chance card lasts 7 s, and every length is a non-negative whole number", () => {
    expect(PLAYBACK_MS.CardDrawn).toBe(7_000);
    expect(
      Object.values(PLAYBACK_MS).every((ms) => Number.isInteger(ms) && ms >= 0),
    ).toBe(true);
  });

  it("ADR-0004: the Playback of an event list is the sum of its events, with Moved scaled by its steps", () => {
    const events: GameEvent[] = [
      { type: "DiceRolled", player: "p1", dice: [2, 3] },
      { type: "Moved", player: "p1", from: 1, to: 9, steps: 8 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ];

    expect(playbackOf(events)).toBe(PLAYBACK_MS.DiceRolled + 8 * PLAYBACK_MS.Moved);
    expect(playbackOf([])).toBe(0);
  });

  it("ADR-0004: a plain Roll's Playback is the dice, the walk, the Tax and the Turn passing", () => {
    const applied = rollOnto(newGame(), TAX, T0);
    const steps = moveStepsOf(applied.events);

    expect(applied.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "Moved",
      "TaxPaid",
      "TurnPassed",
    ]);
    expect(applied.state.actsAfter).toBe(T0 + playbackOf(applied.events));
    expect(playbackOf(applied.events)).toBe(
      PLAYBACK_MS.DiceRolled + steps * PLAYBACK_MS.Moved + PLAYBACK_MS.TaxPaid,
    );
  });

  it("ADR-0004: a Roll past Start counts the Round bonus in its Playback", () => {
    const state = newGame();
    const beforeStart = withPlayer(state, state.currentPlayer, { position: 30 });

    const applied = roll(beforeStart, T0);
    const steps = moveStepsOf(applied.events);

    expect(applied.events.map((event) => event.type)).toContain("RoundBonusPaid");
    expect(playbackOf(applied.events)).toBeGreaterThanOrEqual(
      PLAYBACK_MS.DiceRolled + steps * PLAYBACK_MS.Moved + PLAYBACK_MS.RoundBonusPaid,
    );
    expect(applied.state.actsAfter).toBe(T0 + playbackOf(applied.events));
  });

  it("ADR-0004: a Roll onto Chance includes the 7 s card", () => {
    const applied = rollOnto(newGame(), CHANCE, T0);

    expect(applied.events.some((event) => event.type === "CardDrawn")).toBe(true);
    expect(playbackOf(applied.events)).toBeGreaterThanOrEqual(PLAYBACK_MS.CardDrawn);
    expect(applied.state.actsAfter).toBe(T0 + playbackOf(applied.events));
  });

  it("ADR-0004: a timeout with Auto-sell counts the timeout, the sale and the penalty", () => {
    const owned = withField(newGame(), VESZPREM, { owner: "p1", level: 1 });
    const state = withPlayer(owned, "p1", { cash: 60_000 });

    const applied = timeOut(state);
    const now = deadlineOf(state);

    expect(applied.events.map((event) => event.type)).toEqual([
      "TimedOut",
      "FieldsSold",
      "TimeoutPenaltyPaid",
      "TurnPassed",
    ]);
    expect(applied.state.actsAfter).toBe(now + playbackOf(applied.events));
  });
});

describe("acting after the Playback", () => {
  it("ADR-0004: a new game's first decision is available at once", () => {
    const state = newGame({ now: T0 });

    expect(state.actsAfter).toBe(T0);
    expect(isRejection(apply(state, nextRoll(state), { actor: state.currentPlayer, now: T0 }))).toBe(
      false,
    );
  });

  it("ADR-0004: a Player intent before actsAfter is refused with PLAYBACK_RUNNING, one at exactly actsAfter is accepted", () => {
    const { state } = rollOnto(newGame(), TAX, T0);

    expect(reject(state, nextRoll(state), state.currentPlayer, state.actsAfter - 1)).toEqual({
      code: "PLAYBACK_RUNNING",
    });
    const accepted = apply(state, nextRoll(state), {
      actor: state.currentPlayer,
      now: state.actsAfter,
    });
    expect(isRejection(accepted)).toBe(false);
  });

  it("ADR-0004: a Rejection leaves actsAfter and the deadline alone", () => {
    const { state } = rollOnto(newGame(), TAX, T0);
    const { actsAfter, turnDeadline } = state;

    reject(state, nextRoll(state), state.currentPlayer, actsAfter - 1);

    expect(state.actsAfter).toBe(actsAfter);
    expect(state.turnDeadline).toBe(turnDeadline);
    expect(turnDeadline).toBe(actsAfter + TURN_LIMIT_MS + TURN_SLACK_MS);
  });

  it("ADR-0004: TurnTimedOut is not held by actsAfter", () => {
    const base = newGame();
    // A synthetic state whose Playback is still running at the deadline: only
    // a system intent may act then (a Player intent is held).
    const state = { ...base, actsAfter: deadlineOf(base) + 1 };

    expect(reject(state, nextRoll(state), state.currentPlayer, deadlineOf(base))).toEqual({
      code: "PLAYBACK_RUNNING",
    });
    expect(isRejection(timeOut(state))).toBe(false);
  });
});

describe("the deadline counts from actsAfter", () => {
  it("ADR-0004: actsAfter = now + Playback, and the deadline = actsAfter + the Turn limit + slack", () => {
    const now = T0 + 7_000;

    const applied = rollOnto(newGame(), TAX, now);

    expect(applied.state.actsAfter).toBe(now + playbackOf(applied.events));
    expect(applied.state.turnDeadline).toBe(applied.state.actsAfter + TURN_LIMIT_MS + TURN_SLACK_MS);
  });

  it("ADR-0004: a timeout's deadline also counts from its own Playback", () => {
    const state = newGame();
    const at = deadlineOf(state) + 40;

    const applied = timeOut(state, at);

    expect(applied.state.actsAfter).toBe(at + playbackOf(applied.events));
    expect(applied.state.turnDeadline).toBe(applied.state.actsAfter + TURN_LIMIT_MS + TURN_SLACK_MS);
  });

  it("ADR-0004: the server's Turn limit override applies after the Playback too", () => {
    const base = newGame();
    const rolled = apply(
      base,
      nextRoll(base),
      { actor: base.currentPlayer, now: T0, turnLimitMs: 5_000 },
    );
    if (isRejection(rolled)) throw new Error(`Roll was rejected with ${rolled.code}`);

    expect(rolled.state.actsAfter).toBe(T0 + playbackOf(rolled.events));
    expect(rolled.state.turnDeadline).toBe(rolled.state.actsAfter + 5_000 + TURN_SLACK_MS);
  });
});

describe("the view", () => {
  it("ADR-0004: the view carries actsAfter, and the ring starts emptying there", () => {
    const { state } = rollOnto(newGame(), TAX, T0);

    const view = publicView(state);
    const timer = view.turnTimer;

    expect(view.actsAfter).toBe(state.actsAfter);
    expect(timer).not.toBeNull();
    expect((timer?.endsAt ?? 0) - (timer?.limitMs ?? 0)).toBe(view.actsAfter);
  });
});

/** The `steps` of the event list's `Moved` event. */
function moveStepsOf(events: readonly GameEvent[]): number {
  const moved = events.find((event) => event.type === "Moved");
  if (!moved) throw new Error("no Moved event");
  return moved.steps;
}
