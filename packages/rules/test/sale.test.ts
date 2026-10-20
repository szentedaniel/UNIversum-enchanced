import { describe, expect, it } from "vitest";
import { publicView, START_CASH, SYSTEM, type GameState } from "#index.ts";
import {
  accept,
  deadlineOf,
  newGame,
  player,
  reject,
  rollOnto,
  T0,
  withField,
  withPlayer,
} from "./helpers.ts";
import { playRandomGame } from "./simulation.ts";

// Field ids and their Bank sale values (90% of Value) at the Levels used below.
const VESZPREM = 1; // Level 1: sale 180,000
const BUDAPEST = 2; // Level 1: sale 198,000
const MUSEUM_1 = 4; // sale 360,000
const BERLIN = 15; // Level 4: sale 792,000
const SEATTLE = 17; // Rent at Level 1: 231,000; at Level 4: 924,000; Buyout at Level 1: 840,000
const BERKELEY = 26; // Level 4: sale 1,029,600

/** `state` with `owner` holding each listed Field (Field id → Level; a Museum's Level is 0). */
function owning(state: GameState, owner: string, owned: Record<number, number>): GameState {
  return Object.entries(owned).reduce(
    (s, [id, level]) => withField(s, Number(id), { owner, level }),
    state,
  );
}

/**
 * The second Seat, with `cash` and `owned`, lands on Seattle, which the first
 * Seat owns at `seattleLevel`.
 */
function landOnRent(
  cash: number,
  owned: Record<number, number>,
  seattleLevel = 4,
  start: GameState = newGame(),
) {
  let state = owning(start, "p2", owned);
  state = withField(state, SEATTLE, { owner: "p1", level: seattleLevel });
  state = withPlayer(state, "p2", { cash });
  return rollOnto({ ...state, currentPlayer: "p2" }, SEATTLE);
}

/** Money never goes negative (spec: one solvency rule). */
function expectNoNegativeCash(state: GameState) {
  for (const p of state.players) expect(p.cash).toBeGreaterThanOrEqual(0);
}

describe("the solvency rule on Rent", () => {
  it("R56: cash that covers the Rent pays it, and no Sale opens", () => {
    const { state, events } = landOnRent(1_000_000, { [VESZPREM]: 1 });

    expect(events).toContainEqual({
      type: "RentPaid",
      player: "p2",
      owner: "p1",
      field: SEATTLE,
      amount: 924_000,
    });
    expect(player(state, "p2").cash).toBe(76_000);
    expect(state.phase.kind).not.toBe("selling");
  });

  it("R57, F8: when cash + the sale value of the Player's Fields covers it, a Sale opens for the Shortfall", () => {
    // Cash 100,000 + sale 180,000 + 792,000 = 1,072,000 ≥ 924,000.
    const { state, events } = landOnRent(100_000, { [VESZPREM]: 1, [BERLIN]: 4 });

    expect(state.phase).toEqual({
      kind: "selling",
      shortfall: 824_000,
      resume: { kind: "rent", amount: 924_000, owner: "p1", field: SEATTLE },
    });
    expect(state.currentPlayer).toBe("p2");
    expect(events.some((e) => e.type === "RentPaid" || e.type === "TurnPassed")).toBe(false);
    // Nothing is paid until the Sale.
    expect(player(state, "p2").cash).toBe(100_000);
    expect(player(state, "p1").cash).toBe(START_CASH);
  });

  it("R57, F8: cash counts too: Fields whose sale value alone is short still open a Sale", () => {
    // Sale 792,000 < 924,000, but cash 200,000 makes up the rest.
    const { state } = landOnRent(200_000, { [BERLIN]: 4 });

    expect(state.phase).toMatchObject({ kind: "selling", shortfall: 724_000 });
  });

  it("R70, R72, F12: when cash + every Field can't cover it, the payer is Bankrupt and the owner gets what they could raise", () => {
    // Cash 100,000 + sale 180,000 = 280,000 < 924,000.
    const { state, events } = landOnRent(100_000, { [VESZPREM]: 1 });

    expect(events).toContainEqual({
      type: "RentPaid",
      player: "p2",
      owner: "p1",
      field: SEATTLE,
      amount: 280_000,
    });
    expect(events).toContainEqual({ type: "WentBankrupt", player: "p2", fields: [VESZPREM] });
    expect(player(state, "p1").cash).toBe(START_CASH + 280_000);
    expect(player(state, "p2")).toMatchObject({ cash: 0, bankrupt: true });
    expect(state.fields[VESZPREM]).toEqual({ owner: null, level: 0 });
    expectNoNegativeCash(state);
  });

  it("R14, R71: the Bankrupt Player's Turn passes at once, to the next Seat", () => {
    const { state, events } = landOnRent(100_000, {});

    expect(events.at(-1)).toEqual({ type: "TurnPassed", player: "p3", turn: 2 });
    expect(state.currentPlayer).toBe("p3");
  });
});

/** The second Seat's Sale for Seattle's Level-4 Rent: cash 100,000, Shortfall 824,000. */
const SALE_FIELDS = { [VESZPREM]: 1, [BUDAPEST]: 1, [MUSEUM_1]: 0, [BERLIN]: 4 };
const openSale = () => landOnRent(100_000, SALE_FIELDS).state;

const sell = (state: GameState, fields: number[]) =>
  accept(state, { type: "SellFields", turn: state.turn, fields }, "p2");

describe("a Sale", () => {
  it("R66, R67: Fields whose sale value covers the Shortfall are sold, then the Rent is paid and the Turn passes", () => {
    // 180,000 + 792,000 = 972,000 ≥ 824,000.
    const { state, events } = sell(openSale(), [VESZPREM, BERLIN]);

    expect(events).toEqual([
      {
        type: "FieldsSold",
        player: "p2",
        fields: [VESZPREM, BERLIN],
        amount: 972_000,
        auto: false,
      },
      { type: "RentPaid", player: "p2", owner: "p1", field: SEATTLE, amount: 924_000 },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
    expect(player(state, "p1").cash).toBe(START_CASH + 924_000);
    expectNoNegativeCash(state);
  });

  it("R67: the Player keeps the full sale value, not just the Shortfall", () => {
    const { state } = sell(openSale(), [VESZPREM, BERLIN]);

    expect(player(state, "p2").cash).toBe(100_000 + 972_000 - 924_000);
  });

  it("R62, R67: sold Fields go back to the Bank at Level 0; the others stay", () => {
    const { state } = sell(openSale(), [VESZPREM, BERLIN]);

    expect(state.fields[VESZPREM]).toEqual({ owner: null, level: 0 });
    expect(state.fields[BERLIN]).toEqual({ owner: null, level: 0 });
    expect(state.fields[BUDAPEST]).toEqual({ owner: "p2", level: 1 });
    expect(state.fields[MUSEUM_1]).toEqual({ owner: "p2", level: 0 });
  });

  it("R62: a sold Field loses the Doubler", () => {
    const sale = { ...openSale(), doubler: { field: BERLIN, count: 2 } };

    expect(sell(sale, [VESZPREM, BERLIN]).state.doubler).toBeNull();
  });

  it("R62: the Doubler stays on a Field that wasn't sold", () => {
    const sale = { ...openSale(), doubler: { field: BUDAPEST, count: 1 } };

    expect(sell(sale, [VESZPREM, BERLIN]).state.doubler).toEqual({ field: BUDAPEST, count: 1 });
  });

  it("R66: refuses a pick whose sale value is short of the Shortfall, and changes nothing", () => {
    const sale = openSale();

    // 792,000 < 824,000
    expect(reject(sale, { type: "SellFields", turn: sale.turn, fields: [BERLIN] }, "p2")).toEqual({
      code: "SHORTFALL_NOT_COVERED",
    });
    expect(reject(sale, { type: "SellFields", turn: sale.turn, fields: [] }, "p2")).toEqual({
      code: "SHORTFALL_NOT_COVERED",
    });
  });

  it("R66: refuses another Player's or the Bank's Field, and a Field picked twice", () => {
    const sale = withField(openSale(), SEATTLE + 2, { owner: "p3", level: 4 });
    const selling = (fields: number[]) =>
      reject(sale, { type: "SellFields", turn: sale.turn, fields }, "p2");

    expect(selling([BERLIN, SEATTLE])).toEqual({ code: "NOT_OFFERED" });
    expect(selling([BERLIN, SEATTLE + 2])).toEqual({ code: "NOT_OFFERED" });
    expect(selling([BERLIN, 3])).toEqual({ code: "NOT_OFFERED" });
    expect(selling([BERLIN, BERLIN])).toEqual({ code: "NOT_OFFERED" });
  });

  it("refuses SellFields and AutoSell outside a Sale", () => {
    const state = newGame();

    expect(reject(state, { type: "SellFields", turn: 1, fields: [VESZPREM] }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
    expect(reject(state, { type: "AutoSell", turn: 1 }, "p1")).toEqual({ code: "NOT_OFFERED" });
  });

  it("R17: the Sale gets a fresh deadline", () => {
    const at = T0 + 5_000;
    let state = owning(newGame(), "p2", SALE_FIELDS);
    state = withField(state, SEATTLE, { owner: "p1", level: 4 });
    state = withPlayer(state, "p2", { cash: 100_000 });

    const sale = rollOnto({ ...state, currentPlayer: "p2" }, SEATTLE, at).state;

    expect(sale.turnDeadline).toBe(sale.actsAfter + 23_000);
  });

  it("R52: after a Sale for Rent the Buyout follows when the Player can now pay it", () => {
    // Seattle at Level 1: Rent 231,000, Buyout 840,000. Cash 51,000: Shortfall 180,000.
    const sale = landOnRent(51_000, { [BERLIN]: 4, [BERKELEY]: 4 }, 1).state;

    // 51,000 + 792,000 + 1,029,600 − 231,000 = 1,641,600 ≥ 840,000
    const { state } = sell(sale, [BERLIN, BERKELEY]);

    expect(state.phase).toEqual({ kind: "offer", field: SEATTLE, levels: [], buyout: 840_000 });
    expect(state.currentPlayer).toBe("p2");
  });
});

const autoSell = (state: GameState) => accept(state, { type: "AutoSell", turn: state.turn }, "p2");

describe("Auto-sell", () => {
  it("R68: sells the cheapest Fields first until the Shortfall is covered, then pays", () => {
    // 180,000 + 198,000 + 360,000 = 738,000 < 824,000, so Berlin goes too.
    const { state, events } = autoSell(openSale());

    expect(events.slice(0, 2)).toEqual([
      {
        type: "FieldsSold",
        player: "p2",
        fields: [VESZPREM, BUDAPEST, MUSEUM_1, BERLIN],
        amount: 1_530_000,
        auto: true,
      },
      { type: "RentPaid", player: "p2", owner: "p1", field: SEATTLE, amount: 924_000 },
    ]);
    expect(player(state, "p2").cash).toBe(100_000 + 1_530_000 - 924_000);
  });

  it("F9: stops as soon as the proceeds reach the Shortfall, even exactly", () => {
    // Seattle at Level 1: Rent 231,000; cash 51,000: Shortfall 180,000 = Veszprém's sale value.
    const sale = landOnRent(51_000, { [VESZPREM]: 1, [BUDAPEST]: 1 }, 1).state;

    const { state, events } = autoSell(sale);

    expect(events[0]).toMatchObject({ type: "FieldsSold", fields: [VESZPREM], amount: 180_000 });
    expect(state.fields[BUDAPEST]).toEqual({ owner: "p2", level: 1 });
    expect(player(state, "p2").cash).toBe(0);
    expectNoNegativeCash(state);
  });

  it("the view lists Auto-sell's picks during a Sale, and none outside one", () => {
    const sale = landOnRent(51_000, { [VESZPREM]: 1, [BUDAPEST]: 1 }, 1).state;

    expect(publicView(sale).autoSell).toEqual([VESZPREM]);
    expect(publicView(newGame()).autoSell).toBeNull();
  });
});

const timeOut = (state: GameState) =>
  accept(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, deadlineOf(state));

/** The first Seat, waiting for the dice with `cash` and `owned`. */
const waiting = (cash: number, owned: Record<number, number>) =>
  withPlayer(owning(newGame(), "p1", owned), "p1", { cash });

describe("the Timeout penalty at 100,000 cash or less", () => {
  it("R19: Auto-sell raises the 100,000 first; the Player keeps the rest of the proceeds", () => {
    const { state, events } = timeOut(waiting(60_000, { [VESZPREM]: 1, [BUDAPEST]: 1 }));

    expect(events).toEqual([
      { type: "TimedOut", player: "p1" },
      { type: "FieldsSold", player: "p1", fields: [VESZPREM], amount: 180_000, auto: true },
      { type: "TimeoutPenaltyPaid", player: "p1", amount: 100_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    // Cash pays nothing the Fields could: 60,000 + 180,000 − 100,000.
    expect(player(state, "p1").cash).toBe(140_000);
    expect(state.fields[BUDAPEST]).toEqual({ owner: "p1", level: 1 });
  });

  it("R19: Auto-sell goes cheapest first, even with 100,000 in cash", () => {
    const { state } = timeOut(waiting(100_000, { [MUSEUM_1]: 0, [VESZPREM]: 1 }));

    expect(state.fields[VESZPREM]).toEqual({ owner: null, level: 0 });
    expect(state.fields[MUSEUM_1]).toEqual({ owner: "p1", level: 0 });
    expect(player(state, "p1").cash).toBe(180_000);
  });

  it("R19: with no Fields, cash covers the 100,000", () => {
    const { state, events } = timeOut(waiting(100_000, {}));

    expect(events).toContainEqual({ type: "TimeoutPenaltyPaid", player: "p1", amount: 100_000 });
    expect(player(state, "p1")).toMatchObject({ cash: 0, bankrupt: false });
  });

  it("R19, R70, F7: when cash + every Field is under 100,000 the Player is Bankrupt, without a crash", () => {
    const { state, events } = timeOut(waiting(60_000, {}));

    expect(events).toEqual([
      { type: "TimedOut", player: "p1" },
      { type: "TimeoutPenaltyPaid", player: "p1", amount: 60_000 },
      { type: "WentBankrupt", player: "p1", fields: [] },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(state, "p1")).toMatchObject({ cash: 0, bankrupt: true });
  });

  it("R69: a timeout during a Sale is Auto-sell, the Charge, then the Timeout penalty", () => {
    // Seattle at Level 1: Rent 231,000; cash 51,000: Shortfall 180,000.
    const sale = landOnRent(51_000, { [VESZPREM]: 1, [BUDAPEST]: 1 }, 1).state;

    const { state, events } = timeOut(sale);

    expect(events).toEqual([
      { type: "TimedOut", player: "p2" },
      { type: "FieldsSold", player: "p2", fields: [VESZPREM], amount: 180_000, auto: true },
      { type: "RentPaid", player: "p2", owner: "p1", field: SEATTLE, amount: 231_000 },
      // Cash is now 0, so the penalty sells Budapest.
      { type: "FieldsSold", player: "p2", fields: [BUDAPEST], amount: 198_000, auto: true },
      { type: "TimeoutPenaltyPaid", player: "p2", amount: 100_000 },
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
    expect(player(state, "p2").cash).toBe(98_000);
    expectNoNegativeCash(state);
  });

  it("R69: no Buyout after a timed-out Sale; with more than 100,000 left the penalty is 10%", () => {
    // Berlin sells for 792,000: 51,000 + 792,000 − 231,000 = 612,000, then −61,200.
    const sale = landOnRent(51_000, { [BERLIN]: 4 }, 1).state;

    const { state } = timeOut(sale);

    expect(player(state, "p2").cash).toBe(612_000 - 61_200);
    expect(state.currentPlayer).toBe("p3");
  });
});

describe("Bankrupt Players", () => {
  it("R71: their Fields lose the Doubler", () => {
    let state = owning(newGame(), "p2", { [VESZPREM]: 1 });
    state = { ...state, doubler: { field: VESZPREM, count: 1 } };

    const { state: after } = landOnRent(0, {}, 4, state);

    expect(player(after, "p2").bankrupt).toBe(true);
    expect(after.doubler).toBeNull();
  });

  it("R14: are skipped in turn order from then on", () => {
    const out = landOnRent(0, {}).state; // p2 is out; p3 to play

    const afterP3 = timeOut(out).state;
    const afterP4 = timeOut(afterP3).state;
    const afterP1 = timeOut(afterP4).state;

    expect([afterP3, afterP4, afterP1].map((s) => s.currentPlayer)).toEqual(["p4", "p1", "p3"]);
  });

  it("are never the current Player after a Turn passes", () => {
    const out = landOnRent(0, {}).state;

    expect(player(out, out.currentPlayer).bankrupt).toBe(false);
  });
});

describe("played games", () => {
  it("the seeded games reach Sales and Bankruptcies, and money never goes negative", () => {
    let sales = 0;
    let bankruptcies = 0;

    for (let game = 1; game <= 40; game++) {
      const run = playRandomGame({
        seed: [game, game * 7, game * 13, game * 31],
        choiceSeed: game,
        timeoutEvery: 8,
      });

      for (const step of run.steps) {
        sales += step.after.phase.kind === "selling" ? 1 : 0;
        bankruptcies += step.events.filter((e) => e.type === "WentBankrupt").length;
        expectNoNegativeCash(step.after);
        expect(player(step.after, step.after.currentPlayer).bankrupt).toBe(false);
      }
      expect(run.ended).toBe(true);
    }

    // The games really went through Sales and bankruptcies.
    expect(sales).toBeGreaterThan(0);
    expect(bankruptcies).toBeGreaterThan(0);
  });
});
