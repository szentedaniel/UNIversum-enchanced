import type { FieldView, Phase, PlayerState, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { saleFor, saleMarks, salePickedValue, toggledPicks } from "#pick/sale.ts";

// The pick tray reads the Sale from the view only: the phase, the Fields' sale
// values and Auto-sell's picks (#29).

const VESZPREM = 1; // sale 180,000
const BUDAPEST = 2; // sale 198,000
const MUSEUM_1 = 4; // sale 360,000
const BERLIN = 15; // sale 792,000
const SEATTLE = 17; // the other Player's

const SALES: Record<number, number> = {
  [VESZPREM]: 180_000,
  [BUDAPEST]: 198_000,
  [MUSEUM_1]: 360_000,
  [BERLIN]: 792_000,
  [SEATTLE]: 378_000,
};

const playerState = (id: string, seat: number): PlayerState => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash: 100_000,
  position: SEATTLE,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
  bot: false,
});

const SELLING: Phase = {
  kind: "selling",
  shortfall: 824_000,
  resume: { kind: "rent", amount: 924_000, owner: "p1", field: SEATTLE },
};

function viewWith(phase: Phase, autoSell: number[] | null = null): PublicView {
  const owners: Record<number, string> = {
    [VESZPREM]: "p2",
    [BUDAPEST]: "p2",
    [MUSEUM_1]: "p2",
    [BERLIN]: "p2",
    [SEATTLE]: "p1",
  };
  const fields: FieldView[] = Array.from({ length: FIELD_COUNT }, (_, id) => ({
    owner: owners[id] ?? null,
    level: owners[id] ? 1 : 0,
    value: 0,
    rent: 0,
    sale: SALES[id] ?? 0,
  }));
  return {
    stateVersion: 1,
    version: 7,
    turn: 4,
    currentPlayer: "p2",
    phase,
    actsAfter: 40_000,
    turnDeadline: 50_000,
    turnTimer: { endsAt: 47_000, limitMs: 20_000 },
    settings: {
      maxPlayers: 2,
      minuteLimit: 15,
      startingCash: 2_500_000,
      roundBonus: 250_000,
      turnLimitMs: 20_000,
    },
    endsAt: 0,
    players: [
      { ...playerState("p1", 0), wealth: 100_000 },
      { ...playerState("p2", 1), wealth: 100_000 },
    ],
    fields,
    doubler: null,
    lastChanceCard: null,
    deal: null,
    dealUsed: false,
    autoSell,
    pickOptions: null,
    standings: null,
    summary: null,
  };
}

const AUTO = [VESZPREM, BUDAPEST, MUSEUM_1, BERLIN];

describe("saleFor", () => {
  it("is the current Player's open Sale: Shortfall, Charge, their Fields cheapest first, Auto-sell's picks", () => {
    const sale = saleFor(viewWith(SELLING, AUTO), "p2");

    expect(sale).toEqual({
      key: "4:50000",
      shortfall: 824_000,
      charge: { kind: "rent", amount: 924_000, owner: "p1", field: SEATTLE },
      cash: 100_000,
      pickable: [VESZPREM, BUDAPEST, MUSEUM_1, BERLIN],
      autoSell: AUTO,
    });
  });

  it("is nothing for the other Players, or outside a Sale", () => {
    expect(saleFor(viewWith(SELLING, AUTO), "p1")).toBeNull();
    expect(saleFor(viewWith({ kind: "awaitingRoll" }), "p2")).toBeNull();
  });
});

describe("picking", () => {
  it("a tap toggles a Field in and out of the picks, and never commits", () => {
    expect(toggledPicks([], BERLIN)).toEqual([BERLIN]);
    expect(toggledPicks([BERLIN], VESZPREM)).toEqual([BERLIN, VESZPREM]);
    expect(toggledPicks([BERLIN, VESZPREM], BERLIN)).toEqual([VESZPREM]);
  });

  it("the meter adds up the picked Fields' sale value", () => {
    const view = viewWith(SELLING, AUTO);

    expect(salePickedValue(view, [VESZPREM, BERLIN])).toBe(972_000);
    expect(salePickedValue(view, [])).toBe(0);
  });
});

describe("saleMarks", () => {
  const sale = saleFor(viewWith(SELLING, AUTO), "p2")!;
  const view = viewWith(SELLING, AUTO);

  it("only the Player's Fields can be picked; the picked ones are marked", () => {
    const marks = saleMarks(sale, view, [BERLIN], 10_000);

    expect(marks.pickable).toEqual([VESZPREM, BUDAPEST, MUSEUM_1, BERLIN]);
    expect(marks.picked).toEqual([BERLIN]);
    expect(marks.ringed).toEqual([]);
  });

  it("rings Auto-sell's Fields in the last 5 s while the picks don't cover the Shortfall", () => {
    expect(saleMarks(sale, view, [BERLIN], 5_000).ringed).toEqual(AUTO);
    expect(saleMarks(sale, view, [BERLIN], 5_001).ringed).toEqual([]);
  });

  it("rings nothing once the picks cover the Shortfall", () => {
    expect(saleMarks(sale, view, [VESZPREM, BERLIN], 1_000).ringed).toEqual([]);
  });

  it("ignores picks that are no longer the Player's", () => {
    expect(saleMarks(sale, view, [SEATTLE, BERLIN], 10_000).picked).toEqual([BERLIN]);
  });
});
