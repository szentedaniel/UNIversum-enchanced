import { describe, expect, it } from "vitest";
import { FIELDS, publicView, START_CASH, SYSTEM, type GameState } from "#index.ts";
import { accept, newGame, player, reject, rollOnto, T0, withField, withPlayer } from "./helpers.ts";

// Field ids used below (none of them is reached by passing Start from the
// positions `rollOnto` picks, except where a test says so).
const ZURICH = 5;
const PARIS = 6;
const EDINBURGH = 7;
const CHICAGO = 9;
const AUSTIN = 10;
const PRINCETON = 11;
const VIENNA = 13;
const BERLIN = 15;
const SEATTLE = 17;
const LONDON = 21;

/** The second Seat lands on `field` while the first Seat owns `owned` (Field id → Level). */
function landOnOwned(field: number, owned: Record<number, number>, start = newGame()) {
  let state = start;
  for (const [id, level] of Object.entries(owned)) {
    state = withField(state, Number(id), { owner: "p1", level });
  }
  return rollOnto({ ...state, currentPlayer: "p2" }, field);
}

/** All the cash in the game. */
const totalCash = (state: GameState) => state.players.reduce((sum, p) => sum + p.cash, 0);

/** v1's price table (rules inventory §4.2): Value at Levels 1–4 per University. */
const V1_VALUES: Record<string, readonly number[]> = {
  veszprem: [200_000, 240_000, 320_000, 440_000],
  budapest: [220_000, 264_000, 352_000, 484_000],
  debrecen: [240_000, 288_000, 384_000, 528_000],
  zurich: [260_000, 312_000, 416_000, 572_000],
  paris: [280_000, 336_000, 448_000, 616_000],
  edinburgh: [300_000, 360_000, 480_000, 660_000],
  chicago: [320_000, 384_000, 512_000, 704_000],
  austin: [340_000, 408_000, 544_000, 748_000],
  princeton: [360_000, 432_000, 576_000, 792_000],
  vienna: [380_000, 456_000, 608_000, 836_000],
  berlin: [400_000, 480_000, 640_000, 880_000],
  seattle: [420_000, 504_000, 672_000, 924_000],
  newHaven: [440_000, 528_000, 704_000, 968_000],
  london: [460_000, 552_000, 736_000, 1_012_000],
  oxford: [480_000, 576_000, 768_000, 1_056_000],
  cambridgeUk: [500_000, 600_000, 800_000, 1_100_000],
  berkeley: [520_000, 624_000, 832_000, 1_144_000],
  newYork: [540_000, 648_000, 864_000, 1_188_000],
  stanford: [560_000, 672_000, 896_000, 1_232_000],
  cambridgeUs: [580_000, 696_000, 928_000, 1_276_000],
};

describe("University prices", () => {
  it("R25–R27: every University's Value by Level 0–4 matches v1's price table", () => {
    const universities = FIELDS.filter((f) => f.kind === "university");

    expect(Object.fromEntries(universities.map((f) => [f.key, f.values]))).toEqual(
      Object.fromEntries(Object.entries(V1_VALUES).map(([key, v]) => [key, [0, ...v]])),
    );
  });

  it("R25: only Universities have Levels", () => {
    expect(FIELDS.filter((f) => f.kind !== "university").every((f) => f.values === null)).toBe(
      true,
    );
  });

  it("F1: the Quarantine Field belongs to no Group, so Group 2 is Zurich, Paris and Edinburgh", () => {
    expect(FIELDS[8]?.group).toBeNull();
    expect(FIELDS.filter((f) => f.group === 2).map((f) => f.key)).toEqual([
      "zurich",
      "paris",
      "edinburgh",
    ]);
  });
});

describe("landing on an unowned University", () => {
  it("R49–R50: offers Levels 1–3 at their Value, and the Turn waits for the Player", () => {
    const applied = rollOnto(newGame(), VIENNA);

    expect(applied.state.phase).toEqual({
      kind: "offer",
      field: VIENNA,
      levels: [
        { level: 1, price: 380_000 },
        { level: 2, price: 456_000 },
        { level: 3, price: 608_000 },
      ],
    });
    expect(applied.state.currentPlayer).toBe("p1");
    expect(applied.events.some((e) => e.type === "TurnPassed")).toBe(false);
  });

  it("R49: lists only the Levels the Player can afford", () => {
    const state = withPlayer(newGame(), "p1", { cash: 456_000 });

    const { phase } = rollOnto(state, VIENNA).state;

    expect(phase).toMatchObject({ levels: [{ level: 1 }, { level: 2 }] });
  });

  it("R49: offers nothing when even Level 1 is too dear, and the Turn passes", () => {
    const state = withPlayer(newGame(), "p1", { cash: 379_999 });

    const applied = rollOnto(state, VIENNA);

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.state.currentPlayer).toBe("p2");
  });
});

describe("buying and building", () => {
  it("R54: buying a Level pays its price to the Bank, takes the Field, and ends the Turn", () => {
    const offered = rollOnto(newGame(), VIENNA).state;

    const bought = accept(offered, { type: "BuyLevel", turn: offered.turn, level: 2 }, "p1");

    expect(bought.state.fields[VIENNA]).toEqual({ owner: "p1", level: 2 });
    expect(player(bought.state, "p1").cash).toBe(START_CASH - 456_000);
    expect(bought.events).toEqual([
      { type: "LevelBought", player: "p1", field: VIENNA, level: 2, price: 456_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(bought.state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R20, R54: declining the offer changes nothing and ends the Turn", () => {
    const offered = rollOnto(newGame(), VIENNA).state;

    const declined = accept(offered, { type: "DeclineOffer", turn: offered.turn }, "p1");

    expect(declined.state.fields[VIENNA]).toEqual({ owner: null, level: 0 });
    expect(player(declined.state, "p1").cash).toBe(START_CASH);
    expect(declined.events).toEqual([
      { type: "OfferDeclined", player: "p1", field: VIENNA },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
  });

  it("R50, F24: refuses Level 4 straight from Level 0, and any Level the offer does not list", () => {
    const offered = rollOnto(withPlayer(newGame(), "p1", { cash: 400_000 }), VIENNA).state;

    for (const level of [4, 2, 0, 5]) {
      expect(reject(offered, { type: "BuyLevel", turn: offered.turn, level }, "p1")).toEqual({
        code: "NOT_OFFERED",
      });
    }
  });

  it("R17, R18: the offer gets a fresh deadline; when it runs out, the penalty, nothing bought, and the Turn passes", () => {
    const offered = rollOnto(newGame(), VIENNA, T0 + 5_000).state;
    expect(offered.turnDeadline).toBe(T0 + 5_000 + 23_000);

    const timedOut = accept(
      offered,
      { type: "TurnTimedOut", turn: offered.turn },
      SYSTEM,
      offered.turnDeadline,
    );

    expect(timedOut.state.fields[VIENNA]).toEqual({ owner: null, level: 0 });
    expect(player(timedOut.state, "p1").cash).toBe(START_CASH - 250_000);
    expect(timedOut.state).toMatchObject({ currentPlayer: "p2", phase: { kind: "awaitingRoll" } });
  });

  it("refuses an offer intent outside an offer", () => {
    expect(reject(newGame(), { type: "BuyLevel", turn: 1, level: 1 }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
    expect(reject(newGame(), { type: "DeclineOffer", turn: 1 }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("R58: on their own University the Player pays no Rent and may build on for the Value difference", () => {
    const state = withField(newGame(), BERLIN, { owner: "p1", level: 1 });

    const applied = rollOnto(state, BERLIN);

    expect(applied.state.phase).toEqual({
      kind: "offer",
      field: BERLIN,
      levels: [
        { level: 2, price: 80_000 },
        { level: 3, price: 240_000 },
      ],
    });
    expect(player(applied.state, "p1").cash).toBe(START_CASH);
    expect(applied.events.some((e) => e.type === "RentPaid")).toBe(false);
  });

  it("R31, R50: from Level 3 only Level 4 is offered, at the Value difference", () => {
    const state = withField(newGame(), BERLIN, { owner: "p1", level: 3 });

    const { phase } = rollOnto(state, BERLIN).state;

    expect(phase).toEqual({ kind: "offer", field: BERLIN, levels: [{ level: 4, price: 240_000 }] });
  });

  it("R31: building up from Level 1 to Level 3 costs 1.6 B − 1.0 B and keeps the owner", () => {
    const state = withField(newGame(), BERLIN, { owner: "p1", level: 1 });
    const offered = rollOnto(state, BERLIN).state;

    const built = accept(offered, { type: "BuyLevel", turn: offered.turn, level: 3 }, "p1");

    expect(built.state.fields[BERLIN]).toEqual({ owner: "p1", level: 3 });
    expect(player(built.state, "p1").cash).toBe(START_CASH - 240_000);
  });

  it("R48, F24: a Level-4 University of their own offers nothing, and the Turn passes", () => {
    const state = withField(newGame(), BERLIN, { owner: "p1", level: 4 });

    const applied = rollOnto(state, BERLIN);

    expect(applied.state.currentPlayer).toBe("p2");
    expect(applied.events.at(-1)).toEqual({ type: "TurnPassed", player: "p2", turn: 2 });
  });

  it("R51: building happens only on the Field landed on; every other Field stays as it was", () => {
    const state = withField(newGame(), BERLIN, { owner: "p1", level: 1 });
    const offered = rollOnto(state, VIENNA).state;

    const bought = accept(offered, { type: "BuyLevel", turn: offered.turn, level: 1 }, "p1");

    expect(bought.state.fields.filter((_, id) => id !== VIENNA)).toEqual(
      state.fields.filter((_, id) => id !== VIENNA),
    );
  });
});

describe("Rent", () => {
  it("R28, R56: Rent = Value × 0.55/0.70/0.85/1.00 by Level, paid to the owner", () => {
    const rents = [1, 2, 3, 4].map((level) => {
      const applied = landOnOwned(SEATTLE, { [SEATTLE]: level });
      return [
        START_CASH - player(applied.state, "p2").cash,
        player(applied.state, "p1").cash - START_CASH,
      ];
    });

    expect(rents).toEqual([
      [231_000, 231_000],
      [352_800, 352_800],
      [571_200, 571_200],
      [924_000, 924_000],
    ]);
  });

  it("R56: emits RentPaid, and the Turn passes when no Buyout is affordable", () => {
    const start = withPlayer(newGame(), "p2", { cash: 1_000_000 });

    const applied = landOnOwned(LONDON, { [LONDON]: 2 }, start);

    expect(applied.events.slice(-2)).toEqual([
      { type: "RentPaid", player: "p2", owner: "p1", field: LONDON, amount: 386_400 },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
  });

  it("R29: a Monopoly multiplies Rent by 1.4", () => {
    const applied = landOnOwned(AUSTIN, { [CHICAGO]: 1, [AUSTIN]: 3, [PRINCETON]: 1 });

    expect(START_CASH - player(applied.state, "p2").cash).toBe(647_360);
  });

  it("R29: no Monopoly while another Player owns one University of the Group", () => {
    const start = withField(newGame(), PRINCETON, { owner: "p3", level: 1 });

    const applied = landOnOwned(AUSTIN, { [CHICAGO]: 1, [AUSTIN]: 3 }, start);

    expect(START_CASH - player(applied.state, "p2").cash).toBe(462_400);
  });

  it("F1: Zurich, Paris and Edinburgh make a Monopoly without the Quarantine Field", () => {
    const applied = landOnOwned(PARIS, { [ZURICH]: 1, [PARIS]: 2, [EDINBURGH]: 1 });

    // The owner's gain: the payer's move to Paris passes Start.
    expect(player(applied.state, "p1").cash - START_CASH).toBe(329_280); // 235,200 × 1.4
  });

  it("R47: the owner collects wherever they stand, the Quarantine Field included", () => {
    const start = withPlayer(newGame(), "p1", { position: 8 });

    const applied = landOnOwned(SEATTLE, { [SEATTLE]: 1 }, start);

    expect(player(applied.state, "p1").cash).toBe(START_CASH + 231_000);
  });

  it("R48: a Level-4 University of another Player charges Rent, then the Turn passes", () => {
    const applied = landOnOwned(SEATTLE, { [SEATTLE]: 4 });

    expect(applied.state.phase).toEqual({ kind: "awaitingRoll" });
    expect(applied.state.currentPlayer).toBe("p3");
  });

  it("never takes more than the payer's cash, so money never goes negative (the Sale comes with #29)", () => {
    const start = withPlayer(newGame(), "p2", { cash: 100_000 });

    const applied = landOnOwned(SEATTLE, { [SEATTLE]: 4 }, start);

    expect(player(applied.state, "p2").cash).toBe(0);
    expect(totalCash(applied.state)).toBe(totalCash(start));
  });
});

describe("the view", () => {
  it("R30: carries each Field's Value, current Rent with the Monopoly, and Bank sale value", () => {
    let state = newGame();
    state = withField(state, CHICAGO, { owner: "p1", level: 1 });
    state = withField(state, AUSTIN, { owner: "p1", level: 3 });
    state = withField(state, PRINCETON, { owner: "p1", level: 1 });
    state = withField(state, SEATTLE, { owner: "p2", level: 2 });

    const { fields } = publicView(state);

    expect(fields[AUSTIN]).toEqual({
      owner: "p1",
      level: 3,
      value: 544_000,
      rent: 647_360,
      sale: 489_600,
    });
    expect(fields[SEATTLE]).toEqual({
      owner: "p2",
      level: 2,
      value: 504_000,
      rent: 352_800,
      sale: 453_600,
    });
    expect(fields[VIENNA]).toEqual({ owner: null, level: 0, value: 0, rent: 0, sale: 0 });
    expect(fields[0]).toEqual({ owner: null, level: 0, value: 0, rent: 0, sale: 0 });
  });

  it("carries the offered Levels with their prices", () => {
    const offered = rollOnto(newGame(), VIENNA).state;

    expect(publicView(offered).phase).toEqual({
      kind: "offer",
      field: VIENNA,
      levels: [
        { level: 1, price: 380_000 },
        { level: 2, price: 456_000 },
        { level: 3, price: 608_000 },
      ],
    });
  });
});
