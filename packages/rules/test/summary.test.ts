/**
 * The end-of-game summary figures (spec #177, ticket #235): the biggest Rent
 * paid, the Fields each Player bought, the Monopolies formed and the
 * Bankruptcies, counted in the state as the game runs and rebuilt by
 * `summaryOf` from the same game's events. Tests drive the public interface;
 * a hand-built state grants Fields without pretending anybody bought them.
 */
import { describe, expect, it } from "vitest";
import { publicView, summaryOf, type Applied, type GameState, type GroupId } from "#index.ts";
import { accept, newGame, rollOnto, SEED, withField, withPlayer } from "./helpers.ts";
import { playBotGame, playRandomGame } from "./simulation.ts";

// Field ids (packages/rules/src/board.ts).
const VESZPREM = 1; // Group 1
const BUDAPEST = 2; // Group 1
const DEBRECEN = 3; // Group 1
const MUSEUM_1 = 4;
const VIENNA = 13; // Group 4; Rent 209,000 at Level 1
const SEATTLE = 17; // Rent 924,000 at Level 4
const LONDON = 21; // Group 6; Rent 386,400 at Level 2
const OXFORD = 22; // Group 6
const CAMBRIDGE_UK = 23; // Group 6

const EMPTY = { biggestRent: null, fieldsBought: {}, monopolies: [], bankruptcies: [] };

/** `state` with each listed Field owned by `owner` at Level 0. */
function owning(state: GameState, owner: string, fields: number[]): GameState {
  return fields.reduce((s, field) => withField(s, field, { owner, level: 0 }), state);
}

/** `p2` lands on `field`, which `p1` owns at `level`. */
function landOnOwned(
  field: number,
  level: number,
  start: GameState = newGame({ players: 2 }),
): Applied {
  const state = withField({ ...start, currentPlayer: "p2" }, field, { owner: "p1", level });
  return rollOnto(state, field);
}

/** The current Player buys the first Level offered after landing on an unowned Field. */
function buyFirstLevel(applied: Applied): Applied {
  const { state } = applied;
  return accept(state, { type: "BuyLevel", turn: state.turn, level: 1 }, state.currentPlayer);
}

describe("the summary counters", () => {
  it("spec #177: a fresh game counts nothing, and the counters are plain JSON", () => {
    const state = newGame();

    expect(state.summary).toEqual(EMPTY);
    expect(JSON.parse(JSON.stringify(state.summary))).toEqual(EMPTY);
  });

  it("spec #177: a game with no Rent keeps a null biggest Rent, not an error", () => {
    expect(summaryOf([])).toEqual(EMPTY);
    expect(newGame().summary.biggestRent).toBeNull();
  });

  it("R56: the biggest RentPaid keeps the payer, the owner, the Field and the amount", () => {
    const rolled = landOnOwned(LONDON, 2);

    expect(rolled.state.summary.biggestRent).toEqual({
      payer: "p2",
      owner: "p1",
      field: LONDON,
      amount: 386_400,
    });
  });

  it("R56: a later, smaller Rent does not replace the biggest one", () => {
    const first = landOnOwned(VIENNA, 1);
    const declined = accept(first.state, { type: "DeclineOffer", turn: first.state.turn }, "p2");
    const second = landOnOwned(LONDON, 2, declined.state);
    const declinedAgain = accept(
      second.state,
      { type: "DeclineOffer", turn: second.state.turn },
      "p2",
    );
    const third = landOnOwned(MUSEUM_1, 0, declinedAgain.state);

    expect(third.state.summary.biggestRent).toEqual({
      payer: "p2",
      owner: "p1",
      field: LONDON,
      amount: 386_400,
    });
  });

  it("spec #177: a purchase counts once, and building on the same Field does not count again", () => {
    const landed = rollOnto(newGame({ players: 2 }), VIENNA);
    const bought = buyFirstLevel(landed);
    expect(bought.state.summary.fieldsBought).toEqual({ p1: 1 });

    // The other Seat's Turn passes; the owner lands on their own Field again.
    const passed = accept(
      bought.state,
      { type: "Roll", turn: bought.state.turn },
      bought.state.currentPlayer,
    );
    const rebuilt = rollOnto(passed.state, VIENNA);
    const built = accept(
      rebuilt.state,
      { type: "BuyLevel", turn: rebuilt.state.turn, level: 2 },
      rebuilt.state.currentPlayer,
    );

    expect(built.state.summary.fieldsBought).toEqual({ p1: 1 });
  });

  it("R53: a Museum bought counts as a Field bought", () => {
    const landed = rollOnto(newGame({ players: 2 }), MUSEUM_1);
    const bought = accept(
      landed.state,
      { type: "BuyMuseum", turn: landed.state.turn },
      landed.state.currentPlayer,
    );

    expect(bought.state.summary.fieldsBought).toEqual({ p1: 1 });
  });

  it("R52: a Buyout counts as a Field bought by the Player who pays", () => {
    const rolled = landOnOwned(LONDON, 2);
    const bought = accept(rolled.state, { type: "Buyout", turn: rolled.state.turn }, "p2");

    expect(bought.state.summary.fieldsBought).toEqual({ p2: 1 });
  });

  it("spec #172: a Deal moves Fields without counting them as bought", () => {
    const state = withField(
      withField(newGame({ players: 2 }), VIENNA, { owner: "p1", level: 1 }),
      LONDON,
      { owner: "p2", level: 1 },
    );
    const proposed = accept(
      state,
      {
        type: "ProposeDeal",
        turn: state.turn,
        recipient: "p2",
        give: { fields: [VIENNA], cash: 0 },
        take: { fields: [LONDON], cash: 0 },
      },
      "p1",
    );
    const accepted = accept(
      proposed.state,
      { type: "AcceptDeal", turn: proposed.state.turn },
      "p2",
    );

    expect(accepted.state.fields[VIENNA]?.owner).toBe("p2");
    expect(accepted.state.summary.fieldsBought).toEqual({});
    expect(accepted.state.summary.monopolies).toEqual([]);
  });

  it("R29: buying the last Field of a Group records the Monopoly once", () => {
    const state = owning(newGame({ players: 2 }), "p1", [VESZPREM, BUDAPEST]);
    const landed = rollOnto({ ...state, currentPlayer: "p1" }, DEBRECEN);
    const bought = buyFirstLevel(landed);

    expect(bought.state.summary.monopolies).toEqual([{ player: "p1", group: 1 as GroupId }]);

    // Building on the completed Group is not a second Monopoly.
    const rebuilt = rollOnto(
      accept(bought.state, { type: "Roll", turn: bought.state.turn }, "p2").state,
      DEBRECEN,
    );
    const built = accept(
      rebuilt.state,
      { type: "BuyLevel", turn: rebuilt.state.turn, level: 2 },
      rebuilt.state.currentPlayer,
    );

    expect(built.state.summary.monopolies).toEqual([{ player: "p1", group: 1 as GroupId }]);
  });

  it("R29: an accepted Deal that completes a Group records the Monopoly for the receiver", () => {
    const state = owning(newGame({ players: 2 }), "p1", [VESZPREM, BUDAPEST]);
    const withDebrecen = withField(state, DEBRECEN, { owner: "p2", level: 0 });
    const proposed = accept(
      withDebrecen,
      {
        type: "ProposeDeal",
        turn: withDebrecen.turn,
        recipient: "p2",
        give: { fields: [], cash: 1 },
        take: { fields: [DEBRECEN], cash: 0 },
      },
      "p1",
    );
    const accepted = accept(
      proposed.state,
      { type: "AcceptDeal", turn: proposed.state.turn },
      "p2",
    );

    expect(accepted.state.summary.monopolies).toEqual([{ player: "p1", group: 1 as GroupId }]);
    expect(accepted.state.summary.fieldsBought).toEqual({});
  });

  it("R29: one Deal records both Monopolies it completes, in the order it moves the Fields", () => {
    let state = owning(newGame({ players: 2 }), "p1", [OXFORD, CAMBRIDGE_UK, DEBRECEN]);
    state = owning(state, "p2", [VESZPREM, BUDAPEST, LONDON]);
    const proposed = accept(
      state,
      {
        type: "ProposeDeal",
        turn: state.turn,
        recipient: "p2",
        give: { fields: [DEBRECEN], cash: 0 },
        take: { fields: [LONDON], cash: 0 },
      },
      "p1",
    );
    const accepted = accept(
      proposed.state,
      { type: "AcceptDeal", turn: proposed.state.turn },
      "p2",
    );

    expect(accepted.state.summary.monopolies).toEqual([
      { player: "p2", group: 1 as GroupId },
      { player: "p1", group: 6 as GroupId },
    ]);
  });

  it("R70: Bankruptcies are recorded in order, and returned Fields are not counted as bought", () => {
    let state = owning(newGame({ players: 3 }), "p2", [VESZPREM]);
    state = withField(state, SEATTLE, { owner: "p1", level: 4 });
    state = withPlayer(state, "p2", { cash: 100_000 });
    const first = rollOnto({ ...state, currentPlayer: "p2" }, SEATTLE);
    expect(first.state.summary.bankruptcies).toEqual(["p2"]);

    const second = rollOnto(withPlayer(first.state, "p3", { cash: 100_000 }), SEATTLE);

    expect(second.state.summary.bankruptcies).toEqual(["p2", "p3"]);
    expect(second.state.summary.fieldsBought).toEqual({});
  });

  it("spec #177: the counters stay out of the public view (ticket #236 exposes them)", () => {
    const { state } = landOnOwned(LONDON, 2);

    expect(publicView(state)).not.toHaveProperty("summary");
  });
});

describe("summaryOf, the pure fold of a game's events", () => {
  it("spec #177: it agrees with the counters a seeded random game kept", () => {
    for (const choiceSeed of [1, 2, 3]) {
      const run = playRandomGame({
        seed: SEED,
        choiceSeed,
        players: 4,
        settings: { minuteLimit: 15 },
      });

      expect(run.state.summary).toEqual(summaryOf(run.steps.flatMap((step) => step.events)));
    }
  });

  it("spec #177: it agrees with a Bot game that also proposes Deals", () => {
    const run = playBotGame({
      seed: SEED,
      players: 4,
      settings: { minuteLimit: 15 },
      dealEvery: 2,
    });

    expect(run.state.summary).toEqual(summaryOf(run.steps.flatMap((step) => step.events)));
  });
});
