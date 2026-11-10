import type { FieldView, Phase, PickOption, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { selectedPick, singleMarks, singlePickFor } from "#pick/pick.ts";

// The single-pick tray (Doubler, Erasmus) reads the view only: the phase lists
// the Fields, the view carries each option's effect (#31).

const BUDAPEST = 2;
const MUSEUM_1 = 4;
const LONDON = 21;
const MUSEUM_4 = 28;

const playerState = (id: string, seat: number) => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash: 2_500_000,
  position: 24,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
});

const fieldView = (owner: string | null, rent = 0): FieldView => ({
  owner,
  level: owner === null ? 0 : 1,
  value: 0,
  rent,
  sale: 0,
});

function viewWith(phase: Phase, pickOptions: PickOption[] | null): PublicView {
  return {
    stateVersion: 1,
    version: 7,
    turn: 4,
    currentPlayer: "p1",
    phase,
    actsAfter: 40_000,
    turnDeadline: 50_000,
    turnTimer: { endsAt: 47_000, limitMs: 20_000 },
    settings: { maxPlayers: 2, minuteLimit: 15, startingCash: 2_500_000 },
    endsAt: 0,
    players: [
      { ...playerState("p1", 0), wealth: 2_500_000 },
      { ...playerState("p2", 1), wealth: 2_500_000 },
    ],
    fields: Array.from({ length: FIELD_COUNT }, (_, id) =>
      id === BUDAPEST || id === MUSEUM_1 ? fieldView("p1", 121_000) : fieldView(null),
    ),
    doubler: null,
    lastChanceCard: null,
    autoSell: null,
    pickOptions,
    standings: null,
  };
}

const PLACING: Phase = { kind: "placingDoubler", fields: [BUDAPEST, MUSEUM_1] };
const DOUBLER_OPTIONS: PickOption[] = [
  { kind: "doubler", field: BUDAPEST, rent: 121_000, rentAfter: 242_000 },
  { kind: "doubler", field: MUSEUM_1, rent: 150_000, rentAfter: 300_000 },
];

const ERASMUS: Phase = { kind: "choosingErasmus", fields: [LONDON, MUSEUM_4] };
const ERASMUS_OPTIONS: PickOption[] = [
  { kind: "erasmus", field: LONDON, steps: 29, passesStart: true, bonus: 250_000 },
  { kind: "erasmus", field: MUSEUM_4, steps: 4, passesStart: false, bonus: null },
];

describe("singlePickFor", () => {
  it("is this client's Doubler pick: the offered Fields and their Rent effect", () => {
    expect(singlePickFor(viewWith(PLACING, DOUBLER_OPTIONS), "p1")).toEqual({
      kind: "doubler",
      key: "4:50000",
      pickable: [BUDAPEST, MUSEUM_1],
      options: DOUBLER_OPTIONS,
    });
  });

  it("is this client's Erasmus pick: the destinations and their distance", () => {
    expect(singlePickFor(viewWith(ERASMUS, ERASMUS_OPTIONS), "p1")).toEqual({
      kind: "erasmus",
      key: "4:50000",
      pickable: [LONDON, MUSEUM_4],
      options: ERASMUS_OPTIONS,
    });
  });

  it("is null for another Player's pick and outside a pick", () => {
    expect(singlePickFor(viewWith(PLACING, DOUBLER_OPTIONS), "p2")).toBeNull();
    expect(singlePickFor(viewWith({ kind: "awaitingRoll" }, null), "p1")).toBeNull();
  });
});

describe("selectedPick", () => {
  const pick = singlePickFor(viewWith(PLACING, DOUBLER_OPTIONS), "p1");

  it("keeps the choice made for this decision", () => {
    if (!pick) throw new Error("no pick");
    expect(selectedPick(pick, { key: pick.key, field: BUDAPEST })).toBe(BUDAPEST);
  });

  it("drops a choice from an earlier decision", () => {
    if (!pick) throw new Error("no pick");
    expect(selectedPick(pick, { key: "3:1", field: BUDAPEST })).toBeNull();
    expect(selectedPick(pick, { key: pick.key, field: null })).toBeNull();
  });
});

describe("singleMarks", () => {
  const pick = singlePickFor(viewWith(ERASMUS, ERASMUS_OPTIONS), "p1");

  it("greys every Field but the pickable ones and lifts the chosen one", () => {
    if (!pick) throw new Error("no pick");
    expect(singleMarks(pick, LONDON)).toEqual({
      pickable: [LONDON, MUSEUM_4],
      picked: [LONDON],
      ringed: [],
    });
    expect(singleMarks(pick, null).picked).toEqual([]);
  });
});
