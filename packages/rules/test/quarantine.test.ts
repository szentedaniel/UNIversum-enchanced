import { describe, expect, it } from "vitest";
import { SYSTEM, type GameState, type PlayerState, type Seed } from "#index.ts";
import {
  accept,
  diceOf,
  newGame,
  player,
  playTurn,
  reject,
  roll,
  SEED,
  T0,
  withPlayer,
} from "./helpers.ts";

const QUARANTINE = 8;

/** `p1`, placed so that the next roll ends exactly on the Quarantine Field. */
function aboutToLandOnQuarantine(state: GameState = newGame()): GameState {
  const [a, b] = diceOf(roll(state));
  return withPlayer(state, "p1", { position: (QUARANTINE - (a + b) + 32) % 32 });
}

describe("entering Quarantine", () => {
  it("R39: landing on the Quarantine Field puts the Player in Quarantine for 3 rounds and passes the Turn", () => {
    const applied = roll(aboutToLandOnQuarantine());

    expect(player(applied.state, "p1")).toMatchObject({
      position: QUARANTINE,
      quarantineRounds: 3,
    });
    expect(applied.state.currentPlayer).toBe("p2");
    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R39: the Quarantine notice is an event after the move, not a click, and the Turn passes", () => {
    // The seed's first roll is 9, so reaching Field 8 passes Start.
    const applied = roll(aboutToLandOnQuarantine());

    expect(applied.events.map((e) => e.type)).toEqual([
      "DiceRolled",
      "Moved",
      "RoundBonusPaid",
      "QuarantineEntered",
      "TurnPassed",
    ]);
    expect(applied.events).toContainEqual({ type: "QuarantineEntered", player: "p1", rounds: 3 });
  });

  it("R40: landing on the Quarantine Field while already in Quarantine does nothing", () => {
    // Not reachable through play today (a quarantined Player does not roll
    // normally); the landing still leaves an existing Quarantine alone.
    const state = withPlayer(aboutToLandOnQuarantine(), "p1", { quarantineRounds: 1 });

    const applied = roll(state);

    expect(player(applied.state, "p1").quarantineRounds).toBe(1);
    expect(applied.events.some((e) => e.type === "QuarantineEntered")).toBe(false);
    expect(applied.state.currentPlayer).toBe("p2");
  });
});

/**
 * A 2-Player game on `p2`'s quarantined Turn: `p2` stands on the Quarantine
 * Field with rounds left, and `p1`'s Turn times out (no dice drawn), so the
 * first dice of `seed` are still to come.
 */
function quarantinedTurn(patch: Partial<PlayerState> = {}, seed: Seed = SEED, now = T0): GameState {
  const state = withPlayer(newGame({ players: 2, seed, now }), "p2", {
    position: QUARANTINE,
    quarantineRounds: 2,
    ...patch,
  });
  return timeOut(state).state;
}

const timeOut = (state: GameState) =>
  accept(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, state.turnDeadline);

/** An integer hash: small or patterned raw seed words give correlated first dice. */
function mix(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x7feb_352d);
  h = Math.imul(h ^ (h >>> 15), 0x846c_a68b);
  return h ^ (h >>> 16);
}

/** The first seed (from a fixed search) whose first two dice total 12, or anything but 12. */
function seedRolling(twelve: boolean): Seed {
  for (let i = 1; i <= 1_000; i++) {
    const seed: Seed = [mix(4 * i), mix(4 * i + 1), mix(4 * i + 2), mix(4 * i + 3)];
    const [a, b] = diceOf(roll(newGame({ seed })));
    if ((a + b === 12) === twelve) return seed;
  }
  throw new Error("no such seed in the search range");
}

const choiceWithCash = (cash: number) => quarantinedTurn({ cash }).phase;

describe("a quarantined Turn", () => {
  it("R41: with rounds left the Player gets the Quarantine choice instead of the dice", () => {
    const state = quarantinedTurn();

    expect(state.currentPlayer).toBe("p2");
    expect(state.phase).toEqual({
      kind: "quarantineChoice",
      canBuyPcrTest: true,
      canUsePcrTest: false,
      pcrTestPrice: 200_000,
    });
  });

  it("R41: buying a PCR test is offered only with at least 200,000 cash", () => {
    expect(choiceWithCash(200_000)).toMatchObject({ canBuyPcrTest: true });
    expect(choiceWithCash(199_999)).toMatchObject({ canBuyPcrTest: false });
  });

  it("R41: using a PCR test is offered only to a Player who holds one", () => {
    expect(quarantinedTurn({ hasPcrTest: true }).phase).toMatchObject({ canUsePcrTest: true });
  });

  it("R41: the Quarantine choice is a decision with a fresh deadline", () => {
    const state = quarantinedTurn({}, SEED, T0);

    // p1's Turn timed out at T0 + 23 s; p2's choice is due 23 s after that.
    expect(state.turnDeadline).toBe(T0 + 23_000 + 23_000);
  });

  it("R41: the plain roll is not offered on the Quarantine choice", () => {
    const state = quarantinedTurn();

    expect(reject(state, { type: "Roll", turn: state.turn }, "p2")).toEqual({
      code: "NOT_OFFERED",
    });
  });
});

type ChoiceIntent = "RollForTwelve" | "BuyPcrTest" | "UsePcrTest";

const send = (state: GameState, type: ChoiceIntent, now = T0) =>
  accept(state, { type, turn: state.turn }, state.currentPlayer, now);

describe("the roll for 12", () => {
  it("R24/R42: a 12 frees the Player and moves them 12 Fields with normal landing", () => {
    const state = quarantinedTurn({}, seedRolling(true));

    const applied = send(state, "RollForTwelve");

    expect(diceOf(applied)).toEqual([6, 6]);
    expect(player(applied.state, "p2")).toMatchObject({
      position: QUARANTINE + 12,
      quarantineRounds: null,
    });
    expect(applied.events.map((e) => e.type)).toEqual([
      "DiceRolled",
      "QuarantineReleased",
      "Moved",
    ]);
    // Field 20 is an unowned Museum: the normal landing stops at its offer.
    expect(applied.state.phase).toMatchObject({ kind: "offer", field: QUARANTINE + 12 });
    expect(applied.state.currentPlayer).toBe("p2");
  });

  it("R42: any other roll uses up a round; the Player stays put and the Turn passes", () => {
    const state = quarantinedTurn({}, seedRolling(false));

    const applied = send(state, "RollForTwelve");

    expect(player(applied.state, "p2")).toMatchObject({
      position: QUARANTINE,
      quarantineRounds: 1,
    });
    expect(applied.events).toEqual([
      { type: "DiceRolled", player: "p2", dice: diceOf(applied) },
      { type: "QuarantineRoundUsed", player: "p2", roundsLeft: 1 },
      { type: "TurnPassed", player: "p1", turn: 3 },
    ]);
  });
});

describe("the PCR test", () => {
  it("R43: buying a PCR test costs 200,000 and releases the Player, who then rolls normally this Turn", () => {
    const state = quarantinedTurn();

    const applied = send(state, "BuyPcrTest");

    expect(player(applied.state, "p2")).toMatchObject({
      cash: 2_500_000 - 200_000,
      quarantineRounds: null,
      hasPcrTest: false,
    });
    expect(applied.state).toMatchObject({ currentPlayer: "p2", turn: state.turn });
    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.events).toEqual([
      { type: "PcrTestBought", player: "p2", amount: 200_000 },
      { type: "QuarantineReleased", player: "p2" },
    ]);
    expect(playTurn(applied.state).state.currentPlayer).toBe("p1");
  });

  it("R43: the normal roll after a PCR test gets a fresh deadline", () => {
    const applied = send(quarantinedTurn(), "BuyPcrTest", T0 + 50_000);

    expect(applied.state.turnDeadline).toBe(T0 + 50_000 + 23_000);
  });

  it("R41/R43: buying is refused without 200,000 cash", () => {
    const state = quarantinedTurn({ cash: 199_999 });

    expect(reject(state, { type: "BuyPcrTest", turn: state.turn }, "p2")).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("R44: using a held PCR test spends it and releases the Player, who then rolls normally", () => {
    const state = quarantinedTurn({ hasPcrTest: true });

    const applied = send(state, "UsePcrTest");

    expect(player(applied.state, "p2")).toMatchObject({
      cash: 2_500_000,
      quarantineRounds: null,
      hasPcrTest: false,
    });
    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.events).toEqual([
      { type: "PcrTestUsed", player: "p2" },
      { type: "QuarantineReleased", player: "p2" },
    ]);
  });

  it("R41/R44: using a PCR test is refused when none is held", () => {
    const state = quarantinedTurn();

    expect(reject(state, { type: "UsePcrTest", turn: state.turn }, "p2")).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("the PCR intents are offered only on the Quarantine choice", () => {
    const state = withPlayer(newGame(), "p1", { hasPcrTest: true });

    expect(reject(state, { type: "UsePcrTest", turn: 1 }, "p1")).toEqual({ code: "NOT_OFFERED" });
    expect(reject(state, { type: "BuyPcrTest", turn: 1 }, "p1")).toEqual({ code: "NOT_OFFERED" });
    expect(reject(state, { type: "RollForTwelve", turn: 1 }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
  });
});

describe("serving the Quarantine rounds", () => {
  it("R16/R45: with 0 rounds left the Player is released at the start of their Turn and rolls normally", () => {
    const state = quarantinedTurn({ quarantineRounds: 0 });

    expect(player(state, "p2").quarantineRounds).toBeNull();
    expect(state.phase).toEqual({ kind: "awaitingRoll" });
    expect(playTurn(state).state.currentPlayer).toBe("p1");
  });

  it("R16/R45: the release is an event right after the Turn passes", () => {
    const state = withPlayer(newGame({ players: 2 }), "p2", { quarantineRounds: 0 });

    const applied = timeOut(state);

    expect(applied.events.slice(-2)).toEqual([
      { type: "TurnPassed", player: "p2", turn: 2 },
      { type: "QuarantineReleased", player: "p2" },
    ]);
  });

  it("R45: three failed Turns, then free on the fourth", () => {
    let state = withPlayer(newGame({ players: 2 }), "p2", {
      position: QUARANTINE,
      quarantineRounds: 3,
    });
    const seen: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      state = timeOut(state).state; // p1's Turn
      seen.push(state.phase.kind);
      // p2 sits it out: a timeout on the choice uses up the round (R46).
      if (state.phase.kind === "quarantineChoice") state = timeOut(state).state;
    }

    expect(seen).toEqual([
      "quarantineChoice",
      "quarantineChoice",
      "quarantineChoice",
      "awaitingRoll",
    ]);
  });
});

describe("a timeout on the Quarantine choice", () => {
  it("R46/R18: uses up one round with no penalty, and the Turn passes", () => {
    const state = quarantinedTurn();

    const applied = timeOut(state);

    expect(player(applied.state, "p2")).toMatchObject({ cash: 2_500_000, quarantineRounds: 1 });
    expect(applied.state.currentPlayer).toBe("p1");
    expect(applied.events).toEqual([
      { type: "TimedOut", player: "p2" },
      { type: "QuarantineRoundUsed", player: "p2", roundsLeft: 1 },
      { type: "TurnPassed", player: "p1", turn: state.turn + 1 },
    ]);
  });

  it("R18: after a PCR release, the normal roll times out with the usual penalty", () => {
    const released = send(quarantinedTurn(), "BuyPcrTest").state;

    const applied = timeOut(released);

    expect(applied.events.map((e) => e.type)).toContain("TimeoutPenaltyPaid");
  });
});
