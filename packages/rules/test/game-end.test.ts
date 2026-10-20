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
