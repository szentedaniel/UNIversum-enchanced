import { describe, expect, it } from "vitest";
import { publicView, type Applied, type GameState } from "#index.ts";
import { newGame, rollOnto, T0, withField, withPlayer } from "./helpers.ts";

/** A Museum far enough round the ring that the roll never passes Start. */
const MUSEUM4 = 28;

/**
 * Ends the current Player's Turn with no money changing hands: they land on a
 * Museum they own (no Rent, nothing to buy), so the Turn passes.
 */
function endTurn(state: GameState, now = T0): Applied {
  const owner = state.currentPlayer;
  return rollOnto(withField(state, MUSEUM4, { owner, level: 0 }), MUSEUM4, now);
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
