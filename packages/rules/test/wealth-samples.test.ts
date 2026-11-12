/**
 * The Wealth series (spec #177): one sample of every Player's Wealth per
 * passed Turn, plus the final one at game end, so a later ticket can chart the
 * game. Tests play through the public interface and read the samples off the
 * state only to check what the engine recorded.
 */
import { describe, expect, it } from "vitest";
import { publicView, setupGame, type GameState, type PlayerId } from "#index.ts";
import { newGame, playerOf, playTurn, SEED, seats, T0, withPlayer } from "./helpers.ts";

/** Every Player's Wealth as the view shows it: the number a sample records (R77). */
function wealthInView(state: GameState): Record<PlayerId, number> {
  return Object.fromEntries(publicView(state).players.map((player) => [player.id, player.wealth]));
}

/** A 2-Seat game with a shortened Minute, like the server's e2e override. */
function shortMinuteGame(minuteMs: number): GameState {
  return setupGame({
    seats: seats(2),
    settings: {
      maxPlayers: 2,
      minuteLimit: 15,
      startingCash: 2_500_000,
      roundBonus: 250_000,
      turnLimitMs: 20_000,
    },
    seed: SEED,
    now: T0,
    minuteMs,
  });
}

describe("the Wealth series", () => {
  it("R77: a passed Turn appends one sample with every Player's Wealth", () => {
    const fresh = newGame();
    const { state } = playTurn(fresh);

    expect(fresh.wealthSamples).toEqual([]);
    expect(state.wealthSamples).toHaveLength(1);
    expect(state.wealthSamples[0]?.wealth).toEqual(wealthInView(state));
  });

  it("the sample's Minute is the game Minute it was taken in, counted from the game's start", () => {
    const state = newGame({ settings: { minuteLimit: 15 } });

    const { state: passed } = playTurn(state, T0 + 10 * 60_000);

    expect(passed.wealthSamples.map((sample) => sample.minute)).toEqual([10]);
  });

  it("counts the Minute with the game's own minute length, not a hard-coded 60 s", () => {
    const state = shortMinuteGame(1_000);

    const { state: passed } = playTurn(state, T0 + 5_000);

    // The Roll's Playback can add a few seconds; only a 1 s Minute gets past 5.
    expect(passed.wealthSamples[0]?.minute).toBeGreaterThanOrEqual(5);
  });

  it("R77: a Bankrupt Player's Wealth is 0 in every sample taken after the Bankruptcy", () => {
    const first = playTurn(newGame()).state;
    // p2 went Bankrupt during their Turn, so the Turn stands with p3, as `passTurn` leaves it.
    const bankrupt = {
      ...withPlayer(first, "p2", { cash: 0, bankrupt: true }),
      currentPlayer: "p3",
    };
    const afterBankruptcy = playTurn(bankrupt).state;

    expect(afterBankruptcy.wealthSamples).toHaveLength(2);
    expect(afterBankruptcy.wealthSamples[0]?.wealth["p2"]).toBe(
      playerOf(publicView(first), "p2").wealth,
    );
    expect(afterBankruptcy.wealthSamples[1]?.wealth["p2"]).toBe(0);
  });

  it("the samples and the minute length stay out of the public view (ticket #236 adds the summary)", () => {
    const { state } = playTurn(newGame());
    const view = publicView(state);

    expect(view).not.toHaveProperty("wealthSamples");
    expect(view).not.toHaveProperty("minuteMs");
  });
});
