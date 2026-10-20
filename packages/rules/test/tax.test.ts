import { describe, expect, it } from "vitest";
import { START_CASH, type GameState } from "#index.ts";
import { newGame, player, rollOnto, withField, withPlayer } from "./helpers.ts";

const TAX = 30;
const VESZPREM = 1; // Values 200,000 / 240,000 / 320,000 / 440,000
const PARIS = 6; // Values 280,000 / 336,000 / 448,000 / 616,000
const MUSEUM = 12;
const MUSEUM_2 = 20;

/** The first Seat lands on Tax while owning `owned` (Field id → Level; a Museum's Level is 0). */
function landOnTax(owned: Record<number, number>, start: GameState = newGame()) {
  let state = start;
  for (const [id, level] of Object.entries(owned)) {
    state = withField(state, Number(id), { owner: "p1", level });
  }
  return rollOnto(state, TAX);
}

/** All the cash in the game. */
const totalCash = (state: GameState) => state.players.reduce((sum, p) => sum + p.cash, 0);

describe("landing on Tax", () => {
  it("R36: charges 10% of the Value of the Player's Universities at their current Levels, to the Bank", () => {
    const { state, events } = landOnTax({ [VESZPREM]: 2, [PARIS]: 4 });

    // (240,000 + 616,000) × 10% = 85,600
    expect(events).toContainEqual({ type: "TaxPaid", player: "p1", amount: 85_600 });
    expect(player(state, "p1").cash).toBe(START_CASH - 85_600);
    expect(totalCash(state)).toBe(totalCash(newGame()) - 85_600);
  });

  it("R36, F2: counts every Museum at 400,000, whoever owns it", () => {
    const owned = { [MUSEUM]: 0, [MUSEUM_2]: 0, [VESZPREM]: 1 };

    // (400,000 + 400,000 + 200,000) × 10% = 100,000
    expect(landOnTax(owned).events).toContainEqual({
      type: "TaxPaid",
      player: "p1",
      amount: 100_000,
    });
  });

  it("R36: Fields of other Players don't count", () => {
    const start = withField(newGame(), PARIS, { owner: "p2", level: 3 });

    expect(landOnTax({ [VESZPREM]: 1 }, start).events).toContainEqual({
      type: "TaxPaid",
      player: "p1",
      amount: 20_000,
    });
  });

  it("R36: a Player with no Fields pays 0 Tax, and still sees it", () => {
    const { state, events } = landOnTax({});

    expect(events).toContainEqual({ type: "TaxPaid", player: "p1", amount: 0 });
    expect(player(state, "p1").cash).toBe(START_CASH);
  });

  it("R37: Tax is paid at once with no confirmation, and the Turn passes", () => {
    const { state, events } = landOnTax({ [VESZPREM]: 1 });

    expect(events.map((e) => e.type)).toEqual(["DiceRolled", "Moved", "TaxPaid", "TurnPassed"]);
    expect(state.phase.kind).toBe("awaitingRoll");
    expect(state.currentPlayer).toBe("p2");
  });

  it("R38: until the Sale exists, cash that doesn't cover the Tax pays what it can and never goes negative", () => {
    const start = withPlayer(newGame(), "p1", { cash: 30_000 });
    const { state, events } = landOnTax({ [PARIS]: 4, [MUSEUM]: 0 }, start);

    expect(events).toContainEqual({ type: "TaxPaid", player: "p1", amount: 30_000 });
    expect(player(state, "p1").cash).toBe(0);
  });
});
