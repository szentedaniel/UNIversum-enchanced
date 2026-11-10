import { assert, constantFrom, integer, property, record, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import { botIntent, publicView, type FieldId, type GameState, type PlayerState } from "#index.ts";
import { newGame, playTurn, rollOnto, withField, withPlayer } from "./helpers.ts";
import { playBotGame } from "./simulation.ts";

const VESZPREM = 1;
const BUDAPEST = 2;
const DEBRECEN = 3;
const MUSEUM_1 = 4;
const ZURICH = 5;
const DOUBLER = 16;
const SEATTLE = 17;
const NEW_HAVEN = 19;
const ERASMUS = 24;

/** `state` with `owner` holding each University at Level 1. */
function owning(state: GameState, owner: string, fields: readonly FieldId[]): GameState {
  return fields.reduce((next, field) => withField(next, field, { owner, level: 1 }), state);
}

describe("Bot policy", () => {
  it("Roll: rolls the dice", () => {
    const state = newGame();

    expect(botIntent(publicView(state))).toEqual({ type: "Roll", turn: state.turn });
  });

  describe("Offer", () => {
    it("buys the highest Level the cash reserve allows", () => {
      const landed = rollOnto(newGame(), VESZPREM).state;

      expect(botIntent(publicView(landed))).toEqual({
        type: "BuyLevel",
        turn: landed.turn,
        level: 3,
      });
    });

    it("buys at the reserve's edge and declines just below it", () => {
      const landed = rollOnto(newGame(), VESZPREM).state;

      // Level 1 costs 200,000: exactly 500,000 stays, one forint less does not.
      expect(botIntent(publicView(withPlayer(landed, "p1", { cash: 700_000 })))).toEqual({
        type: "BuyLevel",
        turn: landed.turn,
        level: 1,
      });
      expect(botIntent(publicView(withPlayer(landed, "p1", { cash: 699_999 })))).toEqual({
        type: "DeclineOffer",
        turn: landed.turn,
      });
    });

    it("builds an owned University up", () => {
      const landed = rollOnto(owning(newGame(), "p1", [VESZPREM]), VESZPREM).state;

      expect(botIntent(publicView(landed))).toEqual({
        type: "BuyLevel",
        turn: landed.turn,
        level: 3,
      });
    });

    it("buys a Museum while the reserve allows it", () => {
      const landed = rollOnto(newGame(), MUSEUM_1).state;

      expect(botIntent(publicView(withPlayer(landed, "p1", { cash: 900_000 })))).toEqual({
        type: "BuyMuseum",
        turn: landed.turn,
      });
      expect(botIntent(publicView(withPlayer(landed, "p1", { cash: 899_999 })))).toEqual({
        type: "DeclineOffer",
        turn: landed.turn,
      });
    });

    it("buys out a University that completes a Monopoly", () => {
      let state = owning(newGame(), "p2", [SEATTLE]);
      state = withField(state, NEW_HAVEN, { owner: "p1", level: 1 });
      const landed = rollOnto(state, SEATTLE).state;

      expect(landed.phase).toMatchObject({ kind: "offer", field: SEATTLE });
      expect(botIntent(publicView(landed))).toEqual({ type: "Buyout", turn: landed.turn });
    });

    it("declines a Buyout that does not build towards a Monopoly", () => {
      let state = owning(newGame(), "p2", [SEATTLE]);
      state = owning(state, "p1", [VESZPREM]);
      const landed = rollOnto(state, SEATTLE).state;

      expect(botIntent(publicView(landed))).toEqual({
        type: "DeclineOffer",
        turn: landed.turn,
      });
    });
  });
});

/** The second Seat's Quarantine choice: the first Seat's Turn passes to it. */
function quarantineChoice(patch: Partial<PlayerState> = {}): GameState {
  const state = withPlayer(newGame({ players: 2 }), "p2", { quarantineRounds: 2, ...patch });
  const opened = playTurn(state).state;
  expect(opened.phase.kind).toBe("quarantineChoice");
  return opened;
}

describe("Quarantine choice", () => {
  it("uses a held PCR test", () => {
    const state = quarantineChoice({ hasPcrTest: true });

    expect(botIntent(publicView(state))).toEqual({ type: "UsePcrTest", turn: state.turn });
  });

  it("buys a PCR test to leave early", () => {
    const state = quarantineChoice({ quarantineRounds: 3 });

    expect(botIntent(publicView(state))).toEqual({ type: "BuyPcrTest", turn: state.turn });
  });

  it("rolls for 12 on its last round", () => {
    const state = quarantineChoice({ quarantineRounds: 1 });

    expect(botIntent(publicView(state))).toEqual({ type: "RollForTwelve", turn: state.turn });
  });

  it("rolls for 12 when it cannot afford a test", () => {
    const state = quarantineChoice({ quarantineRounds: 3, cash: 150_000 });

    expect(botIntent(publicView(state))).toEqual({ type: "RollForTwelve", turn: state.turn });
  });
});

/** The second Seat's Sale: Rent on Seattle leaves `cash` short of its Level-4 Rent. */
function openSale(cash: number, fields: Record<FieldId, number>): GameState {
  let state = Object.entries(fields).reduce(
    (next, [field, level]) => withField(next, Number(field), { owner: "p2", level }),
    newGame(),
  );
  state = withField(state, SEATTLE, { owner: "p1", level: 4 });
  state = withPlayer(state, "p2", { cash });
  return rollOnto({ ...state, currentPlayer: "p2" }, SEATTLE).state;
}

describe("Sale", () => {
  const PARIS = 6;
  const EDINBURGH = 7;
  const AUSTIN = 10;
  const PRINCETON = 11;

  it("sells a Field outside its Monopoly first", () => {
    const state = openSale(900_000, {
      [ZURICH]: 1,
      [PARIS]: 1,
      [EDINBURGH]: 1,
      [AUSTIN]: 1,
    });

    expect(state.phase.kind).toBe("selling");
    expect(botIntent(publicView(state))).toEqual({
      type: "SellFields",
      turn: state.turn,
      fields: [AUSTIN],
    });
  });

  it("keeps the Doubler's Field for last", () => {
    const sale = openSale(900_000, {
      [ZURICH]: 1,
      [PARIS]: 1,
      [EDINBURGH]: 1,
      [AUSTIN]: 1,
      [PRINCETON]: 1,
    });
    const state: GameState = { ...sale, doubler: { field: AUSTIN, count: 1 } };

    expect(botIntent(publicView(state))).toEqual({
      type: "SellFields",
      turn: state.turn,
      fields: [PRINCETON],
    });
  });

  it("sells enough cheapest Fields to cover the Shortfall", () => {
    const VIENNA = 13;
    const BERLIN = 15;
    const state = openSale(100_000, {
      [AUSTIN]: 1,
      [PRINCETON]: 1,
      [VIENNA]: 1,
      [BERLIN]: 1,
    });

    expect(botIntent(publicView(state))).toEqual({
      type: "SellFields",
      turn: state.turn,
      fields: [AUSTIN, PRINCETON, VIENNA],
    });
  });
});

describe("Doubler pick", () => {
  it("places the token where the Rent grows most", () => {
    const state = owning(newGame({ players: 2 }), "p1", [VESZPREM, ZURICH]);
    const landed = rollOnto(state, DOUBLER).state;

    expect(landed.phase.kind).toBe("placingDoubler");
    expect(botIntent(publicView(landed))).toEqual({
      type: "PlaceDoubler",
      turn: landed.turn,
      field: ZURICH,
    });
  });

  it("stacks the token where the stack out-earns another Field", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [VESZPREM, ZURICH]);
    const state: GameState = { ...owned, doubler: { field: VESZPREM, count: 1 } };
    const landed = rollOnto(state, DOUBLER).state;

    expect(botIntent(publicView(landed))).toEqual({
      type: "PlaceDoubler",
      turn: landed.turn,
      field: VESZPREM,
    });
  });
});

describe("Erasmus pick", () => {
  it("travels to the Field that completes its Monopoly", () => {
    const state = owning(newGame({ players: 2 }), "p1", [VESZPREM, BUDAPEST]);
    const landed = rollOnto(state, ERASMUS).state;

    expect(landed.phase.kind).toBe("choosingErasmus");
    expect(botIntent(publicView(landed))).toEqual({
      type: "TravelErasmus",
      turn: landed.turn,
      field: DEBRECEN,
    });
  });
});

describe("games driven only by the policy", () => {
  const seedArb = tuple(
    integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
    integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
    integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
    integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
  ).map((words) => (words.every((word) => word === 0) ? ([1, 0, 0, 0] as const) : words));
  const gameArb = record({
    seed: seedArb,
    players: constantFrom<2 | 3 | 4>(2, 3, 4),
    settings: record({ minuteLimit: constantFrom<15 | 30 | 50>(15, 30, 50) }),
  });

  it("the engine accepts every intent and every game ends", () => {
    assert(
      property(gameArb, (game) => {
        const run = playBotGame(game);

        expect(run.ended).toBe(true);
        expect(run.state.phase.kind).toBe("gameOver");
        expect(run.steps.length).toBeGreaterThan(0);
      }),
      { seed: 20261110, numRuns: 20 },
    );
  });

  it("the same seed replays the same game, so the policy has no randomness", () => {
    const options = {
      seed: [1, 2, 3, 4] as const,
      players: 4 as const,
      settings: { minuteLimit: 30 as const },
    };

    const first = playBotGame(options);
    const second = playBotGame(options);

    expect(second.steps.map((step) => [step.intent, step.now])).toEqual(
      first.steps.map((step) => [step.intent, step.now]),
    );
    expect(second.state).toEqual(first.state);
  });
});
