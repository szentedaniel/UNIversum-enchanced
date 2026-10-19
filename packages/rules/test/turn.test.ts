import { describe, expect, it } from "vitest";
import { publicView, ROUND_BONUS, START_CASH, START_FIELD, SYSTEM } from "#index.ts";
import {
  accept,
  diceOf,
  newGame,
  player,
  playTurn,
  reject,
  roll,
  rollOnto,
  SEED,
  T0,
  withPlayer,
} from "./helpers.ts";

describe("the roll", () => {
  it("R21: rolls two six-sided dice and moves the Player forward by their sum", () => {
    const state = newGame();

    const applied = roll(state);
    const [a, b] = diceOf(applied);

    expect([a, b].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true);
    expect(player(applied.state, "p1").position).toBe(a + b);
  });

  it("R21: the dice come from the seeded PRNG in the state, so the same seed gives the same roll", () => {
    const first = roll(newGame({ seed: SEED }));
    const again = roll(newGame({ seed: SEED }));

    expect(diceOf(again)).toEqual(diceOf(first));
  });

  it("R21: the PRNG moves on, so the next roll continues the sequence instead of repeating it", () => {
    const rolls: string[] = [];
    let state = newGame();
    for (let i = 0; i < 20; i++) {
      const turn = playTurn(state);
      rolls.push(diceOf(turn.rolled).join(""));
      state = turn.state;
    }

    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it("R21: over many rolls every face of both dice comes up", () => {
    const faces = [new Set<number>(), new Set<number>()];
    let state = newGame();
    for (let i = 0; i < 200; i++) {
      const turn = playTurn(state);
      const [a, b] = diceOf(turn.rolled);
      faces[0]?.add(a);
      faces[1]?.add(b);
      state = turn.state;
    }

    expect(faces.map((s) => [...s].toSorted((x, y) => x - y))).toEqual([
      [1, 2, 3, 4, 5, 6],
      [1, 2, 3, 4, 5, 6],
    ]);
  });

  it("R23: a move past Field 31 wraps round the 32-Field ring", () => {
    const state = withPlayer(newGame(), "p1", { position: 30 });

    const applied = roll(state);
    const [a, b] = diceOf(applied);

    expect(player(applied.state, "p1").position).toBe((30 + a + b) % 32);
  });

  it("R73: passing Start pays the Round bonus of 250,000", () => {
    const state = withPlayer(newGame(), "p1", { position: 31 });

    const applied = roll(state);

    expect(player(applied.state, "p1").cash).toBe(START_CASH + 250_000);
    expect(applied.events).toContainEqual({
      type: "RoundBonusPaid",
      player: "p1",
      amount: ROUND_BONUS,
    });
  });

  it("R73: landing exactly on Start pays the Round bonus", () => {
    const [a, b] = diceOf(roll(newGame()));
    const state = withPlayer(newGame(), "p1", { position: 32 - (a + b) });

    const applied = roll(state);

    expect(player(applied.state, "p1").position).toBe(0);
    expect(player(applied.state, "p1").cash).toBe(START_CASH + 250_000);
  });

  it("R73: a move that neither passes nor lands on Start pays no Round bonus", () => {
    const applied = roll(newGame());

    expect(player(applied.state, "p1").cash).toBe(START_CASH);
    expect(applied.events.some((e) => e.type === "RoundBonusPaid")).toBe(false);
  });

  it("returns the events in order: DiceRolled, Moved, RoundBonusPaid, TurnPassed", () => {
    const state = withPlayer(newGame(), "p1", { position: 31 });

    const applied = roll(state);
    const [a, b] = diceOf(applied);
    const to = (31 + a + b) % 32;

    expect(applied.events).toEqual([
      { type: "DiceRolled", player: "p1", dice: [a, b] },
      { type: "Moved", player: "p1", from: 31, to, steps: a + b },
      { type: "RoundBonusPaid", player: "p1", amount: 250_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
  });

  it("bumps the state version on every accepted intent", () => {
    const once = rollOnto(newGame(), 13); // Vienna: the roll stops at the offer
    const twice = accept(once.state, { type: "DeclineOffer", turn: 1 }, "p1");

    expect([once.state.version, twice.state.version]).toEqual([1, 2]);
  });

  it("is pure: the input state is left unchanged", () => {
    const state = newGame();
    const before = JSON.stringify(state);

    roll(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("passing the Turn", () => {
  it("R14: after the move the Turn passes to the next Seat, with a new Turn number", () => {
    const applied = rollOnto(newGame(), START_FIELD);

    expect(applied.state.currentPlayer).toBe("p2");
    expect(applied.state.turn).toBe(2);
    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R14: play goes round the Seats in order and back to the first Seat", () => {
    let state = newGame({ settings: { maxPlayers: 3 } });
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      state = playTurn(state).state;
      order.push(state.currentPlayer);
    }

    expect(order).toEqual(["p2", "p3", "p1", "p2"]);
  });

  it("R14: Bankrupt Players are skipped", () => {
    const state = withPlayer(newGame(), "p2", { bankrupt: true });

    const applied = rollOnto(state, START_FIELD);

    expect(applied.state.currentPlayer).toBe("p3");
    expect(applied.events.at(-1)).toEqual({ type: "TurnPassed", player: "p3", turn: 2 });
  });
});

describe("Rejections", () => {
  it("rejects an intent for another Turn as stale, and changes nothing", () => {
    const { state } = playTurn(newGame());

    expect(reject(state, { type: "Roll", turn: 1 }, "p2")).toEqual({ code: "STALE_TURN" });
  });

  it("rejects an intent from a Player whose Turn it is not", () => {
    const state = newGame();

    expect(reject(state, { type: "Roll", turn: 1 }, "p2")).toEqual({ code: "NOT_YOUR_TURN" });
  });

  it("rejects a Player intent sent as the system", () => {
    expect(reject(newGame(), { type: "Roll", turn: 1 }, SYSTEM)).toEqual({
      code: "NOT_YOUR_TURN",
    });
  });

  it("accepts the same roll from the current Player on the current Turn", () => {
    expect(accept(newGame(), { type: "Roll", turn: 1 }, "p1", T0).state.version).toBe(1);
  });
});

describe("publicView", () => {
  it("drops the PRNG state", () => {
    const state = newGame();

    const view = publicView(state);

    expect(view).not.toHaveProperty("rng");
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.rng));
  });

  it("keeps what clients show: Turn, current Player, phase, Players and version", () => {
    const { state } = rollOnto(newGame(), START_FIELD);

    expect(publicView(state)).toMatchObject({
      version: 1,
      turn: 2,
      currentPlayer: "p2",
      phase: { kind: "awaitingRoll" },
      players: state.players,
    });
  });
});
