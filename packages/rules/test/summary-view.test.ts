/**
 * The final Summary in the `PublicView` (spec #177, ticket #236): the Wealth
 * series and the figures the engine counted, `null` until the game is over.
 * Tests read the view through its public interface; the raw state fields are
 * checked only to prove they reach the view through `summary` alone.
 */
import { describe, expect, it } from "vitest";
import { migrate, publicView, summaryOf, type PublicView } from "#index.ts";
import stateV8 from "./fixtures/state-v8.json" with { type: "json" };
import { newGame, playTurn, SEED } from "./helpers.ts";
import { playRandomGame } from "./simulation.ts";

/** A seeded 4-Player game played to its end. */
function finishedGame() {
  return playRandomGame({
    seed: SEED,
    choiceSeed: 3,
    players: 4,
    settings: { minuteLimit: 15 },
  });
}

describe("the summary in the public view", () => {
  it("spec #177: the summary is null while the game runs", () => {
    const fresh = newGame();
    const { state } = playTurn(fresh);

    expect(publicView(fresh).summary).toBeNull();
    expect(publicView(state).summary).toBeNull();
  });

  it("R80, spec #177: the final summary's last sample equals the standings' Wealth", () => {
    const run = finishedGame();
    const view = publicView(run.state);
    const summary = view.summary;
    const standings = view.standings ?? [];

    expect(run.ended).toBe(true);
    expect(summary).not.toBeNull();
    expect(standings).toHaveLength(run.state.players.length);
    const final = summary?.series.at(-1);
    for (const standing of standings) {
      expect(final?.wealth[standing.player]).toBe(standing.wealth);
    }
  });

  it("spec #177: the series carries every sample the engine recorded, the final one included", () => {
    const run = finishedGame();
    const { summary } = publicView(run.state);

    expect(summary?.series).toEqual(run.state.wealthSamples);
    expect(summary?.series.length).toBeGreaterThan(0);
  });

  it("spec #177: the summary's figures equal summaryOf for the same game", () => {
    const run = finishedGame();
    const { summary } = publicView(run.state);
    const folded = summaryOf(run.steps.flatMap((step) => step.events));

    expect(summary).toMatchObject(folded);
  });

  it("spec #177: a state stored before the Wealth series yields a summary with an empty series", () => {
    // A v8 final save: the game is over and the series was never recorded.
    const stored = migrate({
      ...stateV8,
      phase: { kind: "gameOver", winner: "p1", reason: "timeUp" },
      turnDeadline: null,
    });

    expect(publicView(stored).summary).toEqual({
      biggestRent: null,
      fieldsBought: {},
      monopolies: [],
      bankruptcies: [],
      series: [],
    });
  });

  it("spec #177: the raw samples and counters stay out of the view except through the summary", () => {
    const view: PublicView = publicView(finishedGame().state);

    expect(view).not.toHaveProperty("wealthSamples");
    expect(view).not.toHaveProperty("fieldsBought");
    expect(view.summary?.series.length).toBeGreaterThan(0);
  });
});
