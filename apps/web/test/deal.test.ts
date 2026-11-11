import {
  publicView,
  setupGame,
  type FieldState,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Seed,
} from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import { dealCash, dealFields, dealProblem, dealProposal, dealRecipients } from "#deal/deal.ts";

// The Deal composer's rules (spec #172, #194): who this client may put a Deal
// to, which Fields each side may put in, and when a draft is a valid proposal.
// Views come from the real rules engine.

// Field ids (packages/rules/src/board.ts).
const VESZPREM = 1;
const BUDAPEST = 2;
const MUSEUM_1 = 4;
const VIENNA = 13;

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SEED: Seed = [0x1234_5678, -0x2345_6789, 0x0bad_f00d, 0x7777_1111];

/** A freshly started game. */
function newGame(players = 2): GameState {
  return setupGame({
    seats: Array.from({ length: players }, (_, index) => ({
      playerId: `p${index + 1}`,
      name: { adjective: `adj${index}`, noun: `noun${index}` },
    })),
    settings: {
      maxPlayers: 4,
      minuteLimit: 50,
      startingCash: 2_500_000,
      roundBonus: 250_000,
      turnLimitMs: 20_000,
    },
    seed: SEED,
    now: T0,
  });
}

function withPlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === id ? { ...player, ...patch } : player)),
  };
}

function withField(state: GameState, field: FieldId, patch: Partial<FieldState>): GameState {
  return {
    ...state,
    fields: state.fields.map((own, id) => (id === field ? { ...own, ...patch } : own)),
  };
}

/** `owner` holding each listed Field at its Level (`museum` stays 0). */
function owning(state: GameState, owner: PlayerId, levels: Record<number, number>): GameState {
  return Object.entries(levels).reduce(
    (next, [field, level]) => withField(next, Number(field), { owner, level }),
    state,
  );
}

/** `p1` owns two Fields and `p2` two, so every option and refusal has a case. */
function twoOwners(): GameState {
  return owning(owning(newGame(3), "p1", { [VESZPREM]: 1, [BUDAPEST]: 2 }), "p2", {
    [MUSEUM_1]: 0,
    [VIENNA]: 1,
  });
}

const valid = {
  recipient: "p2",
  give: { fields: [VESZPREM], cash: 100_000 },
  take: { fields: [VIENNA], cash: 50_000 },
};

describe("dealRecipients", () => {
  it("offers every other active Player, in Seat order", () => {
    expect(dealRecipients(publicView(twoOwners()), "p1")).toEqual(["p2", "p3"]);
  });

  it("leaves out this client and every Bankrupt Player", () => {
    const view = publicView(withPlayer(twoOwners(), "p2", { bankrupt: true }));

    expect(dealRecipients(view, "p1")).toEqual(["p3"]);
    expect(dealRecipients(view, "p3")).toEqual(["p1"]);
  });
});

describe("dealFields", () => {
  it("is exactly the Fields the owner holds, in Board order", () => {
    const view = publicView(twoOwners());

    expect(dealFields(view, "p1")).toEqual([VESZPREM, BUDAPEST]);
    expect(dealFields(view, "p2")).toEqual([MUSEUM_1, VIENNA]);
    expect(dealFields(view, "p3")).toEqual([]);
    expect(dealFields(view, null)).toEqual([]);
  });
});

describe("dealCash", () => {
  it("is the Player's cash, and 0 without a Player", () => {
    const view = publicView(withPlayer(twoOwners(), "p2", { cash: 1_200_000 }));

    expect(dealCash(view, "p2")).toBe(1_200_000);
    expect(dealCash(view, null)).toBe(0);
    expect(dealCash(view, "missing")).toBe(0);
  });
});

describe("dealProblem", () => {
  it("accepts a Deal both sides can cover", () => {
    expect(dealProblem(publicView(twoOwners()), "p1", valid)).toBeNull();
  });

  it("refuses a missing, own, unknown or Bankrupt recipient", () => {
    const view = publicView(withPlayer(twoOwners(), "p3", { bankrupt: true }));

    expect(dealProblem(view, "p1", { ...valid, recipient: null })).toBe("recipient");
    expect(dealProblem(view, "p1", { ...valid, recipient: "p1" })).toBe("recipient");
    expect(dealProblem(view, "p1", { ...valid, recipient: "missing" })).toBe("recipient");
    expect(dealProblem(view, "p1", { ...valid, recipient: "p3" })).toBe("recipient");
  });

  it("refuses a Deal that moves nothing", () => {
    expect(
      dealProblem(publicView(twoOwners()), "p1", {
        recipient: "p2",
        give: { fields: [], cash: 0 },
        take: { fields: [], cash: 0 },
      }),
    ).toBe("empty");
  });

  it("refuses a Field the side does not own, a Field twice, and a Field both ways", () => {
    const view = publicView(twoOwners());

    expect(
      dealProblem(view, "p1", {
        ...valid,
        give: { fields: [VIENNA], cash: 0 },
      }),
    ).toBe("field");
    expect(
      dealProblem(view, "p1", {
        ...valid,
        take: { fields: [VESZPREM], cash: 0 },
      }),
    ).toBe("field");
    expect(
      dealProblem(view, "p1", {
        ...valid,
        give: { fields: [VESZPREM, VESZPREM], cash: 0 },
      }),
    ).toBe("field");
    expect(
      dealProblem(view, "p1", {
        ...valid,
        give: { fields: [VESZPREM], cash: 0 },
        take: { fields: [VESZPREM], cash: 0 },
      }),
    ).toBe("field");
  });

  it("refuses cash either side cannot pay", () => {
    const view = publicView(withPlayer(twoOwners(), "p2", { cash: 250_000 }));

    expect(dealProblem(view, "p1", { ...valid, give: { fields: [], cash: 2_500_001 } })).toBe(
      "cash",
    );
    expect(dealProblem(view, "p1", { ...valid, take: { fields: [], cash: 250_001 } })).toBe("cash");
    expect(dealProblem(view, "p1", { ...valid, give: { fields: [], cash: -1 } })).toBe("cash");
    expect(dealProblem(view, "p1", { ...valid, give: { fields: [], cash: 1.5 } })).toBe("cash");
  });
});

describe("dealProposal", () => {
  it("builds the ProposeDeal intent the view offers", () => {
    const view = publicView(twoOwners());

    expect(dealProposal(view, "p1", valid)).toEqual({
      type: "ProposeDeal",
      turn: view.turn,
      recipient: "p2",
      give: { fields: [VESZPREM], cash: 100_000 },
      take: { fields: [VIENNA], cash: 50_000 },
    });
  });

  it("sends nothing for an invalid draft", () => {
    const view = publicView(twoOwners());

    expect(
      dealProposal(view, "p1", {
        ...valid,
        give: { fields: [], cash: 0 },
        take: { fields: [], cash: 0 },
      }),
    ).toBeNull();
  });
});
