import type { FieldView, Phase, PickOption, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { saleChecklist, singleChecklist, stepThrough } from "#pick/checklist.ts";
import { singlePickFor } from "#pick/pick.ts";
import { saleFor } from "#pick/sale.ts";

// The tray's Field checklist (#39) reads the same view as the pick: rows in
// the order the Player should choose from, with each row's effect.

const VESZPREM = 1; // sale 180,000
const BUDAPEST = 2; // sale 198,000
const MUSEUM_1 = 4; // sale 360,000
const BERLIN = 15; // sale 792,000
const LONDON = 21; // Erasmus: 29 ahead
const MUSEUM_4 = 28; // Erasmus: 4 ahead

const SALES: Record<number, number> = {
  [VESZPREM]: 180_000,
  [BUDAPEST]: 198_000,
  [MUSEUM_1]: 360_000,
  [BERLIN]: 792_000,
};

const playerState = (id: string, seat: number) => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash: 100_000,
  position: 17,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
});

const fieldView = (owner: string | null, sale = 0): FieldView => ({
  owner,
  level: owner === null ? 0 : 1,
  value: 0,
  rent: 0,
  sale,
});

function viewWith(phase: Phase, autoSell: number[] | null = null): PublicView {
  return {
    stateVersion: 1,
    version: 7,
    turn: 4,
    currentPlayer: "p1",
    phase,
    actsAfter: 40_000,
    turnDeadline: 50_000,
    turnTimer: { endsAt: 47_000, limitMs: 20_000 },
    settings: { maxPlayers: 2, minuteLimit: 15 },
    endsAt: 0,
    players: [
      { ...playerState("p1", 0), wealth: 100_000 },
      { ...playerState("p2", 1), wealth: 2_500_000 },
    ],
    fields: Array.from({ length: FIELD_COUNT }, (_, id) =>
      id in SALES ? fieldView("p1", SALES[id]) : fieldView(null),
    ),
    doubler: null,
    lastChanceCard: null,
    deal: null,
    autoSell,
    pickOptions: null,
    standings: null,
  };
}

const SELLING: Phase = {
  kind: "selling",
  shortfall: 300_000,
  resume: { kind: "rent", amount: 400_000, owner: "p2", field: 17 },
};

const salePick = (autoSell: number[] | null = null) => {
  const pick = saleFor(viewWith(SELLING, autoSell), "p1");
  if (!pick) throw new Error("no Sale");
  return pick;
};

const PLACING: Phase = { kind: "placingDoubler", fields: [BERLIN, BUDAPEST] };
const DOUBLER_OPTIONS: PickOption[] = [
  { kind: "doubler", field: BUDAPEST, rent: 121_000, rentAfter: 242_000 },
  { kind: "doubler", field: BERLIN, rent: 880_000, rentAfter: 1_760_000 },
];

const ERASMUS: Phase = { kind: "choosingErasmus", fields: [LONDON, MUSEUM_4] };
const ERASMUS_OPTIONS: PickOption[] = [
  { kind: "erasmus", field: LONDON, steps: 29, passesStart: true, bonus: 250_000 },
  { kind: "erasmus", field: MUSEUM_4, steps: 4, passesStart: false, bonus: null },
];

function single(kind: "doubler" | "erasmus") {
  const view = kind === "doubler" ? viewWith(PLACING, null) : viewWith(ERASMUS, null);
  const options = kind === "doubler" ? DOUBLER_OPTIONS : ERASMUS_OPTIONS;
  const pick = singlePickFor({ ...view, pickOptions: options }, "p1");
  if (!pick) throw new Error("no pick");
  return pick;
}

describe("saleChecklist", () => {
  it("lists the Player's Fields cheapest first, with Auto-sell's picks badged", () => {
    // saleFor already orders the pickable Fields; the checklist reasserts it
    // because the order is the checklist's contract too.
    const pick = {
      ...salePick([VESZPREM, BUDAPEST]),
      pickable: [BERLIN, VESZPREM, BUDAPEST, MUSEUM_1],
    };
    expect(saleChecklist(pick, viewWith(SELLING))).toEqual([
      { kind: "sale", field: VESZPREM, sale: 180_000, auto: true },
      { kind: "sale", field: BUDAPEST, sale: 198_000, auto: true },
      { kind: "sale", field: MUSEUM_1, sale: 360_000, auto: false },
      { kind: "sale", field: BERLIN, sale: 792_000, auto: false },
    ]);
  });

  it("does not badge any row when Auto-sell has no picks", () => {
    expect(
      saleChecklist(salePick(null), viewWith(SELLING)).map((row) =>
        row.kind === "sale" ? row.auto : false,
      ),
    ).toEqual([false, false, false, false]);
  });
});

describe("singleChecklist", () => {
  it("lists the Doubler's Fields in Board order with their Rent effect", () => {
    expect(singleChecklist(single("doubler"))).toEqual([
      { kind: "doubler", field: BERLIN, rent: 880_000, rentAfter: 1_760_000 },
      { kind: "doubler", field: BUDAPEST, rent: 121_000, rentAfter: 242_000 },
    ]);
  });

  it("lists Erasmus destinations nearest first, with the Start bonus", () => {
    expect(singleChecklist(single("erasmus"))).toEqual([
      { kind: "erasmus", field: MUSEUM_4, steps: 4, bonus: null },
      { kind: "erasmus", field: LONDON, steps: 29, bonus: 250_000 },
    ]);
  });

  it("keeps a pickable Field whose effect is missing, without effect numbers", () => {
    const pick = { ...single("doubler"), options: [] };
    expect(singleChecklist(pick)).toEqual([
      { kind: "doubler", field: BERLIN, rent: null, rentAfter: null },
      { kind: "doubler", field: BUDAPEST, rent: null, rentAfter: null },
    ]);
  });
});

describe("stepThrough", () => {
  const PICKABLE = [VESZPREM, BUDAPEST, BERLIN];

  it("steps forward and wraps round the pickable Fields", () => {
    expect(stepThrough(PICKABLE, VESZPREM, 1)).toBe(BUDAPEST);
    expect(stepThrough(PICKABLE, BERLIN, 1)).toBe(VESZPREM);
  });

  it("steps back and wraps round the pickable Fields", () => {
    expect(stepThrough(PICKABLE, VESZPREM, -1)).toBe(BERLIN);
    expect(stepThrough(PICKABLE, BUDAPEST, -1)).toBe(VESZPREM);
  });

  it("starts at the first or last pickable Field from a Field outside the list", () => {
    expect(stepThrough(PICKABLE, MUSEUM_1, 1)).toBe(VESZPREM);
    expect(stepThrough(PICKABLE, MUSEUM_1, -1)).toBe(BERLIN);
  });

  it("has nowhere to step when no Field is pickable", () => {
    expect(stepThrough([], VESZPREM, 1)).toBeNull();
  });
});
