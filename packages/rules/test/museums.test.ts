import { describe, expect, it } from "vitest";
import { publicView, START_CASH, type GameState } from "#index.ts";
import { accept, newGame, player, reject, rollOnto, withField, withPlayer } from "./helpers.ts";

// The four Museums; `rollOnto` reaches 12, 20 and 28 without passing Start.
const MUSEUM_1 = 4;
const MUSEUM_2 = 12;
const MUSEUM_3 = 20;
const MUSEUM_4 = 28;
const VIENNA = 13;

/** `state` with each listed Field owned by `owner`. */
function owning(state: GameState, owner: string, fields: number[]): GameState {
  return fields.reduce((s, field) => withField(s, field, { owner, level: 0 }), state);
}

describe("landing on an unowned Museum", () => {
  it("R53: offers the Museum for 400,000, and the Turn waits for the Player", () => {
    const applied = rollOnto(newGame(), MUSEUM_2);

    expect(applied.state.phase).toEqual({
      kind: "offer",
      field: MUSEUM_2,
      levels: [],
      museum: 400_000,
    });
    expect(applied.state.currentPlayer).toBe("p1");
    expect(applied.events.some((e) => e.type === "TurnPassed")).toBe(false);
  });

  it("R53: offers nothing to a Player with less than 400,000, and the Turn passes", () => {
    const applied = rollOnto(withPlayer(newGame(), "p1", { cash: 399_999 }), MUSEUM_2);

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.state.currentPlayer).toBe("p2");
  });

  it("R53: buying pays 400,000 to the Bank, takes the Museum, and ends the Turn", () => {
    const offered = rollOnto(newGame(), MUSEUM_3).state;

    const bought = accept(offered, { type: "BuyMuseum", turn: offered.turn }, "p1");

    expect(bought.state.fields[MUSEUM_3]).toEqual({ owner: "p1", level: 0 });
    expect(player(bought.state, "p1").cash).toBe(START_CASH - 400_000);
    expect(bought.events).toEqual([
      { type: "MuseumBought", player: "p1", field: MUSEUM_3, price: 400_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
  });

  it("R20: declining leaves the Museum unowned and ends the Turn", () => {
    const offered = rollOnto(newGame(), MUSEUM_3).state;

    const declined = accept(offered, { type: "DeclineOffer", turn: offered.turn }, "p1");

    expect(declined.state.fields[MUSEUM_3]).toEqual({ owner: null, level: 0 });
    expect(declined.state.currentPlayer).toBe("p2");
  });

  it("refuses BuyMuseum on a University offer, and BuyLevel on a Museum offer", () => {
    const university = rollOnto(newGame(), VIENNA).state;
    const museum = rollOnto(newGame(), MUSEUM_2).state;

    expect(reject(university, { type: "BuyMuseum", turn: 1 }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
    expect(reject(museum, { type: "BuyLevel", turn: 1, level: 1 }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
  });
});

describe("landing on an owned Museum", () => {
  it("R53, R56: another Player's Museum charges Rent to its owner, then the Turn passes", () => {
    const start = owning({ ...newGame(), currentPlayer: "p2" }, "p1", [MUSEUM_2]);

    const applied = rollOnto(start, MUSEUM_2);

    expect(player(applied.state, "p2").cash).toBe(START_CASH - 75_000);
    expect(player(applied.state, "p1").cash).toBe(START_CASH + 75_000);
    expect(applied.events.slice(-2)).toEqual([
      { type: "RentPaid", player: "p2", owner: "p1", field: MUSEUM_2, amount: 75_000 },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
  });

  it("R53: Rent = 75,000 × the Museums the owner holds", () => {
    const rents = [1, 2, 3, 4].map((count) => {
      const museums = [MUSEUM_4, MUSEUM_1, MUSEUM_2, MUSEUM_3].slice(0, count);
      const start = owning({ ...newGame(), currentPlayer: "p2" }, "p1", museums);
      return START_CASH - player(rollOnto(start, MUSEUM_4).state, "p2").cash;
    });

    expect(rents).toEqual([75_000, 150_000, 225_000, 300_000]);
  });

  it("R53: another Player's Museums don't count towards the owner's Rent", () => {
    let start = owning({ ...newGame(), currentPlayer: "p2" }, "p1", [MUSEUM_2]);
    start = owning(start, "p3", [MUSEUM_1, MUSEUM_3]);

    const applied = rollOnto(start, MUSEUM_2);

    expect(START_CASH - player(applied.state, "p2").cash).toBe(75_000);
  });

  it("R53, R58: the owner's own Museum charges nothing and offers nothing; the Turn passes", () => {
    const start = owning(newGame(), "p1", [MUSEUM_2]);

    const applied = rollOnto(start, MUSEUM_2);

    expect(player(applied.state, "p1").cash).toBe(START_CASH);
    expect(applied.state).toMatchObject({ currentPlayer: "p2", phase: { kind: "awaitingRoll" } });
  });

  it("R53: another Player's Museum is never bought out, however much cash the Player has", () => {
    const start = owning({ ...newGame(), currentPlayer: "p2" }, "p1", [MUSEUM_2]);

    const applied = rollOnto(start, MUSEUM_2);

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
  });
});

describe("Museum numbers in the view", () => {
  it("F2: an owned Museum is worth 400,000 whichever Seat owns it, and shows its Rent", () => {
    let state = owning(newGame(), "p1", [MUSEUM_1]);
    state = owning(state, "p2", [MUSEUM_2, MUSEUM_3]);

    const { fields } = publicView(state);

    expect(fields[MUSEUM_1]).toMatchObject({ owner: "p1", value: 400_000, rent: 75_000 });
    expect(fields[MUSEUM_2]).toMatchObject({ owner: "p2", value: 400_000, rent: 150_000 });
    expect(fields[MUSEUM_4]).toMatchObject({ owner: null, value: 0, rent: 0 });
  });

  it("R30: an owned Museum sells to the Bank for 360,000", () => {
    const { fields } = publicView(owning(newGame(), "p2", [MUSEUM_3]));

    expect(fields[MUSEUM_3]?.sale).toBe(360_000);
  });
});
