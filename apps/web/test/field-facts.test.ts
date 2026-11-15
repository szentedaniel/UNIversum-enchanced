import type { FieldView, PlayerState, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { fieldFacts } from "#board/field-facts.ts";

// The Field card and the tiles read a Field's numbers from the view (#26); the
// Level Rent table, the Group's owners, the base price and the Doubler count
// ride in the view since #315 and this is the one mapping for the card (#316).

const VESZPREM = 1;
const BUDAPEST = 2;
const DEBRECEN = 3;
const MUSEUM = 4;

const player = (id: string, seat: number): PlayerState => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash: 0,
  position: 0,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
  bot: false,
});
const owner = player("p1", 0);
const rival = player("p2", 1);

/** A Field nobody owns, with nothing on it. */
const OPEN: FieldView = {
  owner: null,
  level: 0,
  value: 0,
  rent: 0,
  sale: 0,
  levelRents: [],
  basePrice: 0,
  doublers: 0,
};

function viewWith(
  patch: Partial<Record<number, FieldView>>,
  players: PlayerState[] = [owner],
): PublicView {
  return {
    stateVersion: 1,
    version: 1,
    turn: 1,
    currentPlayer: owner.id,
    phase: { kind: "awaitingRoll" },
    actsAfter: 40_000,
    turnDeadline: 0,
    turnTimer: { endsAt: 0, limitMs: 0 },
    settings: {
      maxPlayers: 2,
      minuteLimit: 15,
      startingCash: 2_500_000,
      roundBonus: 250_000,
      turnLimitMs: 20_000,
    },
    endsAt: 0,
    players: players.map((p) => ({ ...p, wealth: p.cash })),
    fields: Array.from({ length: FIELD_COUNT }, (_, id) => patch[id] ?? OPEN),
    doubler: null,
    lastChanceCard: null,
    deal: null,
    dealUsed: false,
    autoSell: null,
    pickOptions: null,
    standings: null,
    summary: null,
  };
}

describe("fieldFacts", () => {
  it("shows no Rent or Value for a University nobody owns", () => {
    const facts = fieldFacts(viewWith({}), VESZPREM);
    expect(facts).toMatchObject({
      ownable: true,
      owner: null,
      level: 0,
      rent: null,
      value: null,
      monopoly: false,
      doublers: 0,
    });
  });

  it("reads an owned University's Rent and Value from the view", () => {
    const view = viewWith({
      [VESZPREM]: {
        ...OPEN,
        owner: owner.id,
        level: 2,
        value: 1_200_000_000,
        rent: 340_000_000,
        sale: 1_080_000_000,
      },
    });
    expect(fieldFacts(view, VESZPREM)).toMatchObject({
      owner,
      level: 2,
      value: 1_200_000_000,
      rent: 340_000_000,
    });
  });

  it("carries the Level Rent table and the Level to highlight", () => {
    const view = viewWith({
      [VESZPREM]: {
        ...OPEN,
        owner: owner.id,
        level: 2,
        levelRents: [200_000, 300_000, 400_000, 500_000],
      },
    });
    expect(fieldFacts(view, VESZPREM)).toMatchObject({
      level: 2,
      levelRents: [200_000, 300_000, 400_000, 500_000],
    });
  });

  it("shows the base price only while nobody owns the Field", () => {
    const unowned = fieldFacts(viewWith({ [VESZPREM]: { ...OPEN, basePrice: 200_000 } }), VESZPREM);
    expect(unowned?.basePrice).toBe(200_000);
    const owned = fieldFacts(
      viewWith({ [VESZPREM]: { ...OPEN, owner: owner.id, basePrice: 200_000 } }),
      VESZPREM,
    );
    expect(owned?.basePrice).toBeNull();
  });

  it("lists the Group's Fields in Board order with their owners", () => {
    const view = viewWith(
      {
        [VESZPREM]: { ...OPEN, owner: owner.id },
        [BUDAPEST]: { ...OPEN, owner: rival.id },
      },
      [owner, rival],
    );
    const group = fieldFacts(view, VESZPREM)?.group;
    expect(group?.map((member) => member.field.id)).toEqual([VESZPREM, BUDAPEST, DEBRECEN]);
    expect(group?.map((member) => member.owner?.id ?? null)).toEqual([owner.id, rival.id, null]);
  });

  it("marks a Monopoly only when one owner holds every Field of the Group", () => {
    const held = { ...OPEN, owner: owner.id };
    expect(
      fieldFacts(viewWith({ [VESZPREM]: held, [BUDAPEST]: held, [DEBRECEN]: held }), VESZPREM),
    ).toMatchObject({ monopoly: true });
    expect(
      fieldFacts(
        viewWith({ [VESZPREM]: held, [BUDAPEST]: { ...OPEN, owner: rival.id }, [DEBRECEN]: held }, [
          owner,
          rival,
        ]),
        VESZPREM,
      ),
    ).toMatchObject({ monopoly: false });
    expect(fieldFacts(viewWith({ [VESZPREM]: held, [BUDAPEST]: held }), VESZPREM)).toMatchObject({
      monopoly: false,
    });
  });

  it("carries how many Doublers stand on the Field", () => {
    expect(fieldFacts(viewWith({ [VESZPREM]: { ...OPEN, doublers: 2 } }), VESZPREM)?.doublers).toBe(
      2,
    );
    expect(fieldFacts(viewWith({}), VESZPREM)?.doublers).toBe(0);
  });

  it("gives a Museum no Level Rents and no Group", () => {
    const facts = fieldFacts(
      viewWith({
        [MUSEUM]: { ...OPEN, owner: owner.id, value: 400_000, rent: 40_000, basePrice: 400_000 },
      }),
      MUSEUM,
    );
    expect(facts).toMatchObject({
      ownable: true,
      levelRents: [],
      group: null,
      monopoly: false,
      basePrice: null,
    });
  });
});
