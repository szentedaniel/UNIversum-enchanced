import { describe, expect, it } from "vitest";
import { publicView, START_CASH, SYSTEM, type Applied, type GameState } from "#index.ts";
import { newGame, player, reject, roll, rollOnto, T0, withField, withPlayer } from "./helpers.ts";

/** A Museum far enough round the ring that the roll never passes Start. */
const MUSEUM4 = 28;
/** Berlin: a University far enough round the ring, with nothing to offer at Level 4. */
const BERLIN = 15;

/** The current Player lands on their own `field` at `level`, which does nothing. */
function endTurnOn(state: GameState, field: number, level: number, now = T0): Applied {
  const owner = state.currentPlayer;
  return rollOnto(withField(state, field, { owner, level }), field, now);
}

/**
 * Ends the current Player's Turn with no money changing hands: they land on a
 * Museum they own (no Rent, nothing to buy), so the Turn passes.
 */
function endTurn(state: GameState, now = T0): Applied {
  return endTurnOn(state, MUSEUM4, 0, now);
}

describe("game end", () => {
  it("R76: with one non-Bankrupt Player left, the game ends at the Turn change and they win", () => {
    const bankrupt = { bankrupt: true, cash: 0 };
    const state = withPlayer(
      withPlayer(withPlayer(newGame({ players: 4 }), "p2", bankrupt), "p3", bankrupt),
      "p4",
      bankrupt,
    );

    const applied = endTurn(state);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p1", reason: "lastPlayer" });
    expect(applied.state.turnDeadline).toBeNull();
    expect(applied.events.at(-1)).toEqual({
      type: "GameEnded",
      winner: "p1",
      reason: "lastPlayer",
    });
    expect(applied.events.some((event) => event.type === "TurnPassed")).toBe(false);
    expect(publicView(applied.state)).toMatchObject({
      phase: { kind: "gameOver", winner: "p1" },
      turnDeadline: null,
      turnTimer: null,
    });
  });
});

describe("the Minute limit", () => {
  const ENDS_AT = T0 + 50 * 60_000;

  const timeUp = (state: GameState): Applied => endTurn(state, ENDS_AT);

  /** p2's wealth, p3's wealth: p1 ends the Turn on a 400,000 Museum, for 900,000. */
  function threePlayers(p2: number, p3: number): GameState {
    const state = withPlayer(withPlayer(newGame({ players: 3 }), "p2", { cash: p2 }), "p3", {
      cash: p3,
    });
    return withPlayer(state, "p1", { cash: 500_000 });
  }

  it("R77: the game ends after the Turn in progress, and the most Wealthy non-Bankrupt Player wins", () => {
    const applied = timeUp(threePlayers(1_500_000, 1_000_000));

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p2", reason: "timeUp" });
    // Wealth = cash + the Value of Fields, each Museum at 400,000 (R77).
    expect(publicView(applied.state).players.map((p) => p.wealth)).toEqual([
      900_000, 1_500_000, 1_000_000,
    ]);
    // The Turn in progress was played out: the roll moved p1 before the game ended.
    expect(applied.events.map((event) => event.type)).toContain("Moved");
    expect(applied.events.at(-1)).toEqual({ type: "GameEnded", winner: "p2", reason: "timeUp" });
  });

  it("R77: the time-up winner is ranked by cash plus the Value of their Fields, Museums at 400,000", () => {
    // p3 has less cash but a Museum, so their Wealth (1.5M) beats p2's 1.4M.
    const state = withField(threePlayers(1_400_000, 1_100_000), 12, { owner: "p3", level: 0 });

    const applied = timeUp(state);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p3", reason: "timeUp" });
  });

  it("R77, F25: tied Wealth goes to more cash", () => {
    // Both 1.5M wealthy: p2 in cash, p3 as 1.1M plus a 400,000 Museum.
    const state = withField(threePlayers(1_500_000, 1_100_000), 12, { owner: "p3", level: 0 });

    const applied = timeUp(state);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p2", reason: "timeUp" });
  });

  it("R77, F25: tied Wealth and cash goes to the earlier Seat", () => {
    const applied = timeUp(threePlayers(1_500_000, 1_500_000));

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p2", reason: "timeUp" });
  });

  it("R77, F5: a Bankrupt Player is never the time-up winner, however rich they look", () => {
    // p3 has no Wealth, p2 is Bankrupt with 0 cash; p1's 900,000 wins.
    const state = withPlayer(threePlayers(0, 0), "p2", { bankrupt: true });

    const applied = timeUp(state);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p1", reason: "timeUp" });
  });

  it("the Minute limit does not end the game before it runs out", () => {
    const applied = endTurn(threePlayers(1_500_000, 1_000_000), ENDS_AT - 1);

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
  });
});

describe("Monopolies", () => {
  const GROUP_FIELDS: Record<number, number[]> = {
    1: [1, 2, 3],
    2: [5, 6, 7],
    3: [9, 10, 11],
  };

  /** A 4-Player game where `owner` owns every Field of `groups`, and `museums`. */
  function owning(owner: string, groups: number[], museums: number[] = []): GameState {
    let state = newGame({ players: 4 });
    for (const id of groups.flatMap((group) => GROUP_FIELDS[group] ?? [])) {
      state = withField(state, id, { owner, level: 0 });
    }
    for (const id of museums) state = withField(state, id, { owner, level: 0 });
    return state;
  }

  it("R78: a Player who owns all 4 Museums wins at the Turn change (a Super-monopoly)", () => {
    // p1's harmless landing is on Berlin, so the Museum set stays p2's.
    const applied = endTurnOn(owning("p2", [], [4, 12, 20, 28]), BERLIN, 4);

    expect(applied.state.phase).toEqual({
      kind: "gameOver",
      winner: "p2",
      reason: "superMonopoly",
    });
    expect(applied.events.at(-1)).toEqual({
      type: "GameEnded",
      winner: "p2",
      reason: "superMonopoly",
    });
  });

  it("R79: a Player holding 3 Monopolies wins at the Turn change", () => {
    const applied = endTurnOn(owning("p2", [1, 2, 3]), BERLIN, 4);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p2", reason: "monopolies" });
  });

  it("R79: 2 Monopolies and 3 Museums do not end the game (Museums are no Group)", () => {
    const applied = endTurnOn(owning("p2", [1, 2], [4, 12, 20]), BERLIN, 4);

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.events.some((event) => event.type === "GameEnded")).toBe(false);
  });

  it("R76-R79: the Minute limit outranks a Super-monopoly", () => {
    // p2 holds every Museum, but p3 is the Wealthiest when the time runs out.
    const state = withPlayer(owning("p2", [], [4, 12, 20, 28]), "p3", { cash: 5_000_000 });

    const applied = endTurnOn(state, BERLIN, 4, T0 + 50 * 60_000);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p3", reason: "timeUp" });
  });

  it("R76-R79: the conditions are checked in order: one Player left outranks a Super-monopoly", () => {
    const bankrupt = { bankrupt: true, cash: 0 };
    const state = withPlayer(
      withPlayer(
        withPlayer(withPlayer(owning("p1", [], [4, 12, 20, 28]), "p2", bankrupt), "p3", bankrupt),
        "p4",
        bankrupt,
      ),
      "p1",
      { cash: 0 },
    );

    const applied = endTurnOn(state, BERLIN, 4);

    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p1", reason: "lastPlayer" });
  });
});

describe("a Bankrupt Player leaving", () => {
  it("R76: the last opponent going Bankrupt during their Turn ends the game at the Turn change", () => {
    // p2 owns Berlin at Level 1; p1 has nothing to sell, so the Rent makes them Bankrupt.
    const state = withPlayer(
      withField(newGame({ players: 2 }), BERLIN, { owner: "p2", level: 1 }),
      "p1",
      { cash: 0 },
    );

    const applied = rollOnto(state, BERLIN);

    expect(applied.events.map((event) => event.type)).toContain("WentBankrupt");
    expect(applied.state.phase).toEqual({ kind: "gameOver", winner: "p2", reason: "lastPlayer" });
  });
});

describe("after the game ends", () => {
  /** p1 rolling onto Berlin at Level 4 ends the Turn, and p2, p3 and p4 are Bankrupt. */
  const ended = (): Applied => {
    const bankrupt = { bankrupt: true, cash: 0 };
    return endTurn(
      withPlayer(
        withPlayer(withPlayer(newGame({ players: 4 }), "p2", bankrupt), "p3", bankrupt),
        "p4",
        bankrupt,
      ),
    );
  };

  it("R80: no Player intent is accepted any more", () => {
    const { state } = ended();

    expect(reject(state, { type: "Roll", turn: state.turn }, state.currentPlayer)).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("no Turn can time out any more: the game has no deadline", () => {
    const { state } = ended();

    expect(reject(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, T0 + 60_000)).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("R73: the Turn in progress still pays what it earned before the game ended", () => {
    // p1 passes Start (from 31), so the Round bonus is paid before the game ends.
    const state = withPlayer(newGame({ players: 4 }), "p1", { position: 31 });
    const bankrupt = { bankrupt: true, cash: 0 };
    const applied = roll(
      withPlayer(withPlayer(withPlayer(state, "p2", bankrupt), "p3", bankrupt), "p4", bankrupt),
    );

    expect(player(applied.state, "p1").cash).toBeGreaterThan(START_CASH);
    expect(applied.state.phase).toMatchObject({ kind: "gameOver" });
  });
});
