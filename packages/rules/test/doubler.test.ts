import { describe, expect, it } from "vitest";
import { publicView, SYSTEM, type GameState } from "#index.ts";
import {
  accept,
  deadlineOf,
  newGame,
  player,
  reject,
  rollOnto,
  withField,
  withPlayer,
} from "./helpers.ts";

const VESZPREM = 1;
const BUDAPEST = 2;
const DEBRECEN = 3;
const MUSEUM_1 = 4;
const ZURICH = 5;
const MUSEUM_2 = 12;
const BERLIN = 15;
const DOUBLER = 16;

/** `state` with `fields` owned by `playerId` at Level 1 (a Museum stays Level 0). */
function owning(state: GameState, playerId: string, fields: readonly number[]): GameState {
  return fields.reduce((next, id) => {
    const level = id === MUSEUM_1 || id === MUSEUM_2 ? 0 : 1;
    return withField(next, id, { owner: playerId, level });
  }, state);
}

/** The current Player lands on the Doubler Field. */
const landingOnDoubler = (state: GameState) => rollOnto(state, DOUBLER);

describe("landing on the Doubler Field", () => {
  it("R59: with Fields, the phase offers the Player's own Universities and Museums", () => {
    const state = owning(newGame({ players: 2 }), "p1", [VESZPREM, BUDAPEST, MUSEUM_1]);

    const landed = landingOnDoubler(state);

    expect(landed.state.phase).toEqual({
      kind: "placingDoubler",
      fields: [VESZPREM, BUDAPEST, MUSEUM_1],
    });
    expect(landed.state.currentPlayer).toBe("p1");
  });

  it("R59: the Turn passes at once when the Player owns no Field", () => {
    const state = owning(newGame({ players: 2 }), "p2", [ZURICH]);

    const landed = landingOnDoubler(state);

    expect(landed.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(landed.state.currentPlayer).toBe("p2");
    expect(landed.state.doubler).toBeNull();
  });
});

describe("placing the Doubler", () => {
  it("R59/R63: with no Fields the Turn passes at once", () => {
    const landed = landingOnDoubler(newGame({ players: 2 }));

    expect(landed.state.currentPlayer).toBe("p2");
    expect(landed.state.turn).toBe(2);
    expect(landed.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(landed.state.doubler).toBeNull();
    expect(player(landed.state, "p1").cash).toBe(2_500_000);
  });

  it("R60: placing it on one of the Player's Fields puts the one Doubler there and passes the Turn", () => {
    const landed = landingOnDoubler(owning(newGame({ players: 2 }), "p1", [BUDAPEST]));

    const placed = accept(
      landed.state,
      { type: "PlaceDoubler", turn: landed.state.turn, field: BUDAPEST },
      "p1",
    );

    expect(placed.state.doubler).toEqual({ field: BUDAPEST, count: 1 });
    expect(placed.state.currentPlayer).toBe("p2");
    expect(placed.state.turn).toBe(2);
    expect(placed.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(placed.events.some((event) => event.type === "DoublerPlaced")).toBe(true);
  });

  it("R60: placing it again on the same Field stacks the count", () => {
    const landed = landingOnDoubler(owning(newGame({ players: 2 }), "p1", [BUDAPEST]));
    const first = accept(
      landed.state,
      { type: "PlaceDoubler", turn: landed.state.turn, field: BUDAPEST },
      "p1",
    );
    const again = landingOnDoubler({ ...first.state, currentPlayer: "p1" });

    const second = accept(
      again.state,
      { type: "PlaceDoubler", turn: again.state.turn, field: BUDAPEST },
      "p1",
    );

    expect(second.state.doubler).toEqual({ field: BUDAPEST, count: 2 });
  });

  it("F11: placing it moves the one Doubler off another Player's Field", () => {
    const landed = landingOnDoubler(owning(newGame({ players: 2 }), "p1", [BUDAPEST]));
    const first = accept(
      landed.state,
      { type: "PlaceDoubler", turn: landed.state.turn, field: BUDAPEST },
      "p1",
    );
    const theirs = owning(first.state, "p2", [ZURICH]);
    const p2Landed = landingOnDoubler({ ...theirs, currentPlayer: "p2" });

    const moved = accept(
      p2Landed.state,
      { type: "PlaceDoubler", turn: p2Landed.state.turn, field: ZURICH },
      "p2",
    );

    expect(moved.state.doubler).toEqual({ field: ZURICH, count: 1 });
  });

  it("R60: a Field the Player does not own is not offered", () => {
    const landed = landingOnDoubler(owning(newGame({ players: 2 }), "p2", [ZURICH]));
    const placed = { ...landed.state, currentPlayer: "p2" };

    const refused = reject(
      placed,
      { type: "PlaceDoubler", turn: placed.turn, field: BUDAPEST },
      "p2",
    );

    expect(refused).toMatchObject({ code: "NOT_OFFERED" });
  });

  it("R19/R63: a Timeout on the placement gives the normal penalty and passes the Turn", () => {
    const landed = landingOnDoubler(owning(newGame({ players: 2 }), "p1", [BUDAPEST]));

    const timedOut = accept(
      landed.state,
      { type: "TurnTimedOut", turn: landed.state.turn },
      SYSTEM,
      deadlineOf(landed.state),
    );

    expect(player(timedOut.state, "p1").cash).toBe(2_250_000);
    expect(timedOut.state.doubler).toBeNull();
    expect(timedOut.state.currentPlayer).toBe("p2");
  });
});

describe("Doubler Rent", () => {
  it("F10: on a Monopoly University it is plain Rent × 2, without the ×1.4", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [VESZPREM, BUDAPEST, DEBRECEN]);
    const state: GameState = { ...owned, doubler: { field: BUDAPEST, count: 1 } };

    // Budapest at Level 1: Value 220,000, plain Rent 121,000 (× 2 = 242,000;
    // with a Monopoly it would be 169,400 × 2).
    expect(publicView(state).fields[BUDAPEST]?.rent).toBe(242_000);

    const landed = rollOnto({ ...state, currentPlayer: "p2" }, BUDAPEST);
    const bonus = landed.events.some((event) => event.type === "RoundBonusPaid") ? 250_000 : 0;

    expect(player(landed.state, "p2").cash).toBe(2_500_000 + bonus - 242_000);
    expect(player(landed.state, "p1").cash).toBe(2_500_000 + 242_000);
  });

  it("R61: the count multiplies again (×3 at count 2)", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [BUDAPEST]);

    for (const [count, rent] of [
      [0, 121_000],
      [1, 242_000],
      [2, 363_000],
    ] as const) {
      const state: GameState = { ...owned, doubler: { field: BUDAPEST, count } };

      expect(publicView(state).fields[BUDAPEST]?.rent).toBe(rent);
    }
  });

  it("R61: a Museum keeps its count multiplier (75,000 × Museums × (count + 1))", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [MUSEUM_1, MUSEUM_2]);
    const state: GameState = { ...owned, doubler: { field: MUSEUM_1, count: 1 } };

    expect(publicView(state).fields[MUSEUM_1]?.rent).toBe(300_000);

    const landed = rollOnto({ ...state, currentPlayer: "p2" }, MUSEUM_1);
    const bonus = landed.events.some((event) => event.type === "RoundBonusPaid") ? 250_000 : 0;

    expect(player(landed.state, "p2").cash).toBe(2_500_000 + bonus - 300_000);
  });

  it("R62: a sold Field loses the Doubler", () => {
    const base = owning(newGame({ players: 2 }), "p2", [BERLIN]);
    let state = withField(base, BUDAPEST, { owner: "p1", level: 1 });
    state = withPlayer(state, "p1", { cash: 100_000 });
    state = { ...state, doubler: { field: BUDAPEST, count: 1 } };

    const landed = rollOnto(state, BERLIN);

    expect(landed.state.phase.kind).toBe("selling");

    const sold = accept(
      landed.state,
      { type: "SellFields", turn: landed.state.turn, fields: [BUDAPEST] },
      "p1",
    );

    expect(sold.state.doubler).toBeNull();
    expect(sold.state.fields[BUDAPEST]).toEqual({ owner: null, level: 0 });
  });

  it("R62: going Bankrupt loses the Doubler", () => {
    const base = owning(newGame({ players: 2 }), "p2", [BERLIN]);
    let state = withField(base, BUDAPEST, { owner: "p1", level: 1 });
    state = withPlayer(state, "p1", { cash: 0 });
    state = { ...state, doubler: { field: BUDAPEST, count: 2 } };

    const landed = rollOnto(state, BERLIN);

    expect(player(landed.state, "p1").bankrupt).toBe(true);
    expect(landed.state.doubler).toBeNull();
    expect(landed.state.fields[BUDAPEST]).toEqual({ owner: null, level: 0 });
  });
});

describe("the Doubler pick in the view", () => {
  it("lists each offered Field's Rent now and after placing it there", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [BUDAPEST, MUSEUM_1]);
    const state: GameState = { ...owned, doubler: { field: MUSEUM_1, count: 1 } };

    const landed = landingOnDoubler(state);
    const view = publicView(landed.state);

    expect(view.pickOptions).toEqual([
      { kind: "doubler", field: BUDAPEST, rent: 121_000, rentAfter: 242_000 },
      { kind: "doubler", field: MUSEUM_1, rent: 150_000, rentAfter: 225_000 },
    ]);
  });

  it("after placing it again on the same Field, the effect is the next count", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [BUDAPEST]);
    const state: GameState = { ...owned, doubler: { field: BUDAPEST, count: 1 } };

    const landed = landingOnDoubler(state);
    const view = publicView(landed.state);

    expect(view.pickOptions).toEqual([
      { kind: "doubler", field: BUDAPEST, rent: 242_000, rentAfter: 363_000 },
    ]);
  });

  it("R61: the option's rentAfter is the Rent the Field charges once it is placed there", () => {
    const owned = owning(newGame({ players: 2 }), "p1", [BUDAPEST, MUSEUM_1]);
    const landed = landingOnDoubler(owned);
    const option = publicView(landed.state).pickOptions?.find(
      (pick) => pick.kind === "doubler" && pick.field === BUDAPEST,
    );
    if (option?.kind !== "doubler") throw new Error("no Doubler option for Budapest");

    const placed = accept(
      landed.state,
      { type: "PlaceDoubler", turn: landed.state.turn, field: BUDAPEST },
      "p1",
    );

    expect(publicView(placed.state).fields[BUDAPEST]?.rent).toBe(option.rentAfter);
  });
});
