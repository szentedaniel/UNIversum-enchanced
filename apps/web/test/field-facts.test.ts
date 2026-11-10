import type { FieldView, PlayerState, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { fieldFacts } from "#board/field-facts.ts";

// The Field card and the tiles read a Field's Rent and Value from the view (#26).

const VESZPREM = 1;
const owner: PlayerState = {
  id: "p1",
  name: { adjective: "happy", noun: "tiger" },
  seat: 0,
  cash: 0,
  position: 0,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
  bot: false,
};

function viewWith(field: FieldView): PublicView {
  return {
    stateVersion: 1,
    version: 1,
    turn: 1,
    currentPlayer: owner.id,
    phase: { kind: "awaitingRoll" },
    actsAfter: 40_000,
    turnDeadline: 0,
    turnTimer: { endsAt: 0, limitMs: 0 },
    settings: { maxPlayers: 2, minuteLimit: 15, startingCash: 2_500_000 },
    endsAt: 0,
    players: [{ ...owner, wealth: owner.cash }],
    fields: Array.from({ length: FIELD_COUNT }, (_, id) =>
      id === VESZPREM ? field : { owner: null, level: 0, value: 0, rent: 0, sale: 0 },
    ),
    doubler: null,
    lastChanceCard: null,
    deal: null,
    dealUsed: false,
    autoSell: null,
    pickOptions: null,
    standings: null,
  };
}

describe("fieldFacts", () => {
  it("shows no Rent or Value for a University nobody owns", () => {
    const facts = fieldFacts(
      viewWith({ owner: null, level: 0, value: 0, rent: 0, sale: 0 }),
      VESZPREM,
    );
    expect(facts).toMatchObject({ ownable: true, owner: null, level: 0, rent: null, value: null });
  });

  it("reads an owned University's Rent and Value from the view", () => {
    const view = viewWith({
      owner: "p1",
      level: 2,
      value: 1_200_000_000,
      rent: 340_000_000,
      sale: 1_080_000_000,
    });
    expect(fieldFacts(view, VESZPREM)).toMatchObject({
      owner,
      level: 2,
      value: 1_200_000_000,
      rent: 340_000_000,
    });
  });
});
