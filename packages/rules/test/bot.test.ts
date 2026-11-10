import { describe, expect, it } from "vitest";
import { botIntent, publicView, type FieldId, type GameState } from "#index.ts";
import { newGame, rollOnto, withField, withPlayer } from "./helpers.ts";

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
