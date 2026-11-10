import { describe, expect, it } from "vitest";
import { botIntent, publicView, type FieldId, type GameState, type PlayerState } from "#index.ts";
import { newGame, playTurn, rollOnto, withField, withPlayer } from "./helpers.ts";

const VESZPREM = 1;
const SEATTLE = 17;
const NEW_HAVEN = 19;
const MUSEUM_1 = 4;

/** `state` with `owner` holding each Field at Level 1 (a Museum stays Level 0). */
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
  const ZURICH = 5;
  const PARIS = 6;
  const EDINBURGH = 7;
  const CHICAGO = 9;
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
