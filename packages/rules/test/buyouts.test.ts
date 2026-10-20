import { describe, expect, it } from "vitest";
import { publicView, START_CASH, type GameState } from "#index.ts";
import { accept, newGame, player, reject, rollOnto, withField, withPlayer } from "./helpers.ts";

// Field ids; `rollOnto` reaches them without passing Start.
const VIENNA = 13;
const SEATTLE = 17;
const LONDON = 21;
const MUSEUM_2 = 12;

/** The second Seat lands on `field`, a University `owner` holds at `level`. */
function landOnOwned(field: number, level: number, owner = "p1", start: GameState = newGame()) {
  const state = withField({ ...start, currentPlayer: "p2" }, field, { owner, level });
  return rollOnto(state, field);
}

describe("the Buyout offer", () => {
  it("R52, R56: after Rent, another Player's University below Level 4 is offered at 200% of its Value", () => {
    const applied = landOnOwned(LONDON, 2);

    // London at Level 2: Value 552,000, Rent 386,400.
    expect(applied.events.at(-1)).toEqual({
      type: "RentPaid",
      player: "p2",
      owner: "p1",
      field: LONDON,
      amount: 386_400,
    });
    expect(applied.state.phase).toEqual({
      kind: "offer",
      field: LONDON,
      levels: [],
      buyout: 1_104_000,
    });
    expect(applied.state.currentPlayer).toBe("p2");
  });

  it("R52: the Player must afford the price with what is left after Rent", () => {
    // Vienna at Level 1: Value 380,000, Rent 209,000, Buyout 760,000.
    const enough = withPlayer(newGame(), "p2", { cash: 209_000 + 760_000 });
    const short = withPlayer(newGame(), "p2", { cash: 209_000 + 759_999 });

    expect(landOnOwned(VIENNA, 1, "p1", enough).state.phase).toMatchObject({ buyout: 760_000 });
    const passed = landOnOwned(VIENNA, 1, "p1", short).state;
    expect(passed).toMatchObject({ currentPlayer: "p3", phase: { kind: "awaitingRoll" } });
  });

  it("R48, F24: a Level-4 University is never offered for a Buyout", () => {
    const applied = landOnOwned(SEATTLE, 4);

    expect(applied.state).toMatchObject({ currentPlayer: "p3", phase: { kind: "awaitingRoll" } });
  });

  it("R52: the view carries the Buyout price", () => {
    const offered = landOnOwned(SEATTLE, 3).state;

    expect(publicView(offered).phase).toEqual({
      kind: "offer",
      field: SEATTLE,
      levels: [],
      buyout: 1_344_000,
    });
  });
});

describe("buying out", () => {
  it("R52: the Player pays the price to the owner and takes the University at its Level; the Turn passes", () => {
    const offered = landOnOwned(LONDON, 2, "p3").state;
    const payerBefore = player(offered, "p2").cash;

    const bought = accept(offered, { type: "Buyout", turn: offered.turn }, "p2");

    expect(bought.state.fields[LONDON]).toEqual({ owner: "p2", level: 2 });
    expect(player(bought.state, "p2").cash).toBe(payerBefore - 1_104_000);
    expect(player(bought.state, "p3").cash).toBe(START_CASH + 386_400 + 1_104_000);
    expect(bought.events).toEqual([
      { type: "BoughtOut", player: "p2", owner: "p3", field: LONDON, level: 2, price: 1_104_000 },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
  });

  it("F3 fixed: buying out the first Seat's University pays the first Seat", () => {
    const offered = landOnOwned(VIENNA, 1, "p1").state;

    const bought = accept(offered, { type: "Buyout", turn: offered.turn }, "p2");

    expect(player(bought.state, "p1").cash).toBe(START_CASH + 209_000 + 760_000);
  });

  it("R55: a Doubler on the bought-out University stays there", () => {
    const start = { ...newGame(), doubler: { field: VIENNA, count: 2 } };
    const offered = landOnOwned(VIENNA, 1, "p1", start).state;

    const bought = accept(offered, { type: "Buyout", turn: offered.turn }, "p2");

    expect(bought.state.doubler).toEqual({ field: VIENNA, count: 2 });
    expect(bought.state.fields[VIENNA]?.owner).toBe("p2");
  });

  it("R20: declining the Buyout keeps the owner and ends the Turn", () => {
    const offered = landOnOwned(LONDON, 2).state;

    const declined = accept(offered, { type: "DeclineOffer", turn: offered.turn }, "p2");

    expect(declined.state.fields[LONDON]).toEqual({ owner: "p1", level: 2 });
    expect(declined.events).toEqual([
      { type: "OfferDeclined", player: "p2", field: LONDON },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
  });

  it("refuses a Buyout the offer doesn't list, and other buys on a Buyout offer", () => {
    const buyout = landOnOwned(LONDON, 2).state;
    const university = rollOnto(newGame(), VIENNA).state;
    const museum = rollOnto(newGame(), MUSEUM_2).state;
    const notOffered = { code: "NOT_OFFERED" };

    expect(reject(university, { type: "Buyout", turn: 1 }, "p1")).toEqual(notOffered);
    expect(reject(museum, { type: "Buyout", turn: 1 }, "p1")).toEqual(notOffered);
    expect(reject(newGame(), { type: "Buyout", turn: 1 }, "p1")).toEqual(notOffered);
    expect(reject(buyout, { type: "BuyLevel", turn: 1, level: 3 }, "p2")).toEqual(notOffered);
    expect(reject(buyout, { type: "BuyMuseum", turn: 1 }, "p2")).toEqual(notOffered);
  });
});
