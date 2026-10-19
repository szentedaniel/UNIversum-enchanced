import { describe, expect, it } from "vitest";
import { publicView, START_CASH, SYSTEM, TURN_LIMIT_MS, TURN_SLACK_MS } from "#index.ts";
import { accept, newGame, player, reject, roll, T0, withPlayer } from "./helpers.ts";

/** 20 s on the ring plus about 3 s of slack for animations (F22). */
const DEADLINE_AFTER = 23_000;

const timeOut = (state: ReturnType<typeof newGame>, now = state.turnDeadline) =>
  accept(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, now);

describe("the Turn timer", () => {
  it("F22: the Turn limit is 20 s and the slack about 3 s", () => {
    expect([TURN_LIMIT_MS, TURN_SLACK_MS]).toEqual([20_000, 3_000]);
  });

  it("R17: a new game's first decision gets a deadline of now + 20 s + slack", () => {
    expect(newGame({ now: T0 }).turnDeadline).toBe(T0 + DEADLINE_AFTER);
  });

  it("R17: every decision restarts the timer: the next Player's roll is due 23 s after the move", () => {
    const later = T0 + 7_000;

    const applied = roll(newGame(), later);

    expect(applied.state.phase.kind).toBe("awaitingRoll");
    expect(applied.state.turnDeadline).toBe(later + DEADLINE_AFTER);
  });

  it("R17: a Rejection leaves the deadline alone", () => {
    const state = newGame();

    reject(state, { type: "Roll", turn: 1 }, "p2", T0 + 5_000);

    expect(state.turnDeadline).toBe(T0 + DEADLINE_AFTER);
  });

  it("the view shows the deadline and the 20 s ring, which ends `slack` before the deadline", () => {
    const view = publicView(newGame({ now: T0 }));

    expect(view.turnDeadline).toBe(T0 + DEADLINE_AFTER);
    expect(view.turnTimer).toEqual({ endsAt: T0 + 20_000, limitMs: 20_000 });
  });
});

describe("TurnTimedOut", () => {
  it("R18: outside a Sale or the Quarantine choice, the Turn passes to the next Player", () => {
    const applied = timeOut(newGame());

    expect(applied.state.currentPlayer).toBe("p2");
    expect(applied.state.turn).toBe(2);
    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R18: the next Player's Turn gets a fresh deadline from the moment of the timeout", () => {
    const at = T0 + DEADLINE_AFTER + 40;

    const applied = timeOut(newGame(), at);

    expect(applied.state.turnDeadline).toBe(at + DEADLINE_AFTER);
  });

  it("R19: with more than 100,000 cash the Timeout penalty is 10% of cash", () => {
    const applied = timeOut(newGame());

    expect(player(applied.state, "p1").cash).toBe(START_CASH - 250_000);
  });

  it("R19: the 10% is rounded to the nearest forint", () => {
    const state = withPlayer(newGame(), "p1", { cash: 123_455 });

    const applied = timeOut(state);

    expect(player(applied.state, "p1").cash).toBe(123_455 - 12_346);
  });

  it("R19: 100,001 cash is still the upper branch", () => {
    const state = withPlayer(newGame(), "p1", { cash: 100_001 });

    expect(player(timeOut(state).state, "p1").cash).toBe(100_001 - 10_000);
  });

  it("R18/R19: the events say who timed out, the penalty, then the Turn passing", () => {
    const applied = timeOut(newGame());

    expect(applied.events).toEqual([
      { type: "TimedOut", player: "p1" },
      { type: "TimeoutPenaltyPaid", player: "p1", amount: 250_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
  });

  it("R18: the other Players' cash is untouched (the penalty goes to the Bank)", () => {
    const applied = timeOut(newGame());

    expect(applied.state.players.slice(1).map((p) => p.cash)).toEqual([
      START_CASH,
      START_CASH,
      START_CASH,
    ]);
  });

  it("a stale TurnTimedOut (an earlier Turn) is rejected and changes nothing", () => {
    const state = roll(newGame()).state;

    expect(reject(state, { type: "TurnTimedOut", turn: 1 }, SYSTEM, state.turnDeadline)).toEqual({
      code: "STALE_TURN",
    });
  });

  it("a TurnTimedOut before the deadline is not offered", () => {
    const state = newGame();

    expect(
      reject(state, { type: "TurnTimedOut", turn: 1 }, SYSTEM, state.turnDeadline - 1),
    ).toEqual({ code: "NOT_OFFERED" });
  });

  it("a Player cannot send TurnTimedOut", () => {
    const state = newGame();

    expect(reject(state, { type: "TurnTimedOut", turn: 1 }, "p1", state.turnDeadline)).toEqual({
      code: "NOT_YOUR_TURN",
    });
  });

  it("the timeout skips Bankrupt Players when the Turn passes", () => {
    const state = withPlayer(newGame(), "p2", { bankrupt: true });

    expect(timeOut(state).state.currentPlayer).toBe("p3");
  });
});
