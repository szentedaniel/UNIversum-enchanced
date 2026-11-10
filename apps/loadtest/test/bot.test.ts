import { describe, expect, it } from "vitest";
import type { ClientIntent, GameMessage } from "@universum/protocol/messages";
import { chooseIntent, isGameOver, isMyTurn, offeredIntents } from "#bot.ts";

type View = GameMessage["view"];

const view = (phase: View["phase"], extra: Partial<View> = {}): View => ({
  stateVersion: 1,
  version: 7,
  turn: 12,
  currentPlayer: "p0",
  phase,
  actsAfter: 0,
  turnDeadline: 1_000,
  turnTimer: { endsAt: 1_000, limitMs: 20_000 },
  settings: { maxPlayers: 4, minuteLimit: 15, startingCash: 2_500_000 },
  endsAt: 900_000,
  players: [
    {
      id: "p0",
      name: { adjective: "brave", noun: "otter" },
      seat: 0,
      cash: 2_500_000,
      wealth: 2_500_000,
      position: 0,
      bankrupt: false,
      quarantineRounds: null,
      hasPcrTest: false,
    },
  ],
  fields: [],
  doubler: null,
  lastChanceCard: null,
  autoSell: null,
  pickOptions: null,
  standings: null,
  ...extra,
});

// A kind this client does not know: outside the rules' union, as a stale client would see it.
const unknownPhase = (kind: string): View["phase"] =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stale client sees a kind the rules do not define
  ({ kind }) as View["phase"];

const types = (intents: ClientIntent[]) => intents.map((intent) => intent.type).toSorted();

describe("bot decisions", () => {
  it("rolls when the Room awaits a roll", () => {
    expect(offeredIntents(view({ kind: "awaitingRoll" }), "p0")).toEqual([
      { type: "Roll", turn: 12 },
    ]);
  });

  it("does nothing when it is another Player's decision", () => {
    expect(offeredIntents(view({ kind: "awaitingRoll" }), "p1")).toEqual([]);
    expect(isMyTurn(view({ kind: "awaitingRoll" }), "p1")).toBe(false);
  });

  it("offers every Quarantine choice the view allows", () => {
    expect(
      types(
        offeredIntents(
          view({
            kind: "quarantineChoice",
            canBuyPcrTest: false,
            canUsePcrTest: false,
            pcrTestPrice: 200_000,
          }),
          "p0",
        ),
      ),
    ).toEqual(["RollForTwelve"]);
    expect(
      types(
        offeredIntents(
          view({
            kind: "quarantineChoice",
            canBuyPcrTest: true,
            canUsePcrTest: true,
            pcrTestPrice: 200_000,
          }),
          "p0",
        ),
      ),
    ).toEqual(["BuyPcrTest", "RollForTwelve", "UsePcrTest"]);
  });

  it("takes every offered Level, the Buyout or Museum, or declines", () => {
    const intents = offeredIntents(
      view({
        kind: "offer",
        field: 3,
        levels: [
          { level: 2, price: 40_000 },
          { level: 3, price: 120_000 },
        ],
        buyout: 1_000_000,
        museum: 400_000,
      }),
      "p0",
    );
    expect(types(intents)).toEqual(["BuyLevel", "BuyLevel", "BuyMuseum", "Buyout", "DeclineOffer"]);
    expect(intents).toContainEqual({ type: "BuyLevel", turn: 12, level: 2 });
    expect(intents).toContainEqual({ type: "BuyLevel", turn: 12, level: 3 });
    expect(intents).toContainEqual({ type: "Buyout", turn: 12 });
  });

  it("only offers a Buyout or Museum when the view does", () => {
    const intents = offeredIntents(
      view({ kind: "offer", field: 3, levels: [{ level: 1, price: 200_000 }] }),
      "p0",
    );
    expect(types(intents)).toEqual(["BuyLevel", "DeclineOffer"]);
  });

  it("auto-sells or sells Auto-sell's picks during a Sale", () => {
    const phase: View["phase"] = {
      kind: "selling",
      shortfall: 100_000,
      resume: { kind: "tax", amount: 1 },
    };
    expect(types(offeredIntents(view(phase, { autoSell: [4, 9] }), "p0"))).toEqual([
      "AutoSell",
      "SellFields",
    ]);
    expect(offeredIntents(view(phase, { autoSell: [4, 9] }), "p0")).toContainEqual({
      type: "SellFields",
      turn: 12,
      fields: [4, 9],
    });
    expect(types(offeredIntents(view(phase, { autoSell: null }), "p0"))).toEqual(["AutoSell"]);
  });

  it("places the Doubler on each offered Field", () => {
    expect(offeredIntents(view({ kind: "placingDoubler", fields: [2, 5] }), "p0")).toEqual([
      { type: "PlaceDoubler", turn: 12, field: 2 },
      { type: "PlaceDoubler", turn: 12, field: 5 },
    ]);
  });

  it("travels to each offered Erasmus Field", () => {
    expect(offeredIntents(view({ kind: "choosingErasmus", fields: [9, 22] }), "p0")).toEqual([
      { type: "TravelErasmus", turn: 12, field: 9 },
      { type: "TravelErasmus", turn: 12, field: 22 },
    ]);
  });

  it("leaves a phase it does not know to the Turn timer", () => {
    expect(offeredIntents(view(unknownPhase("someFuturePhase")), "p0")).toEqual([]);
  });

  it("picks uniformly from what the view offers", () => {
    const roll = view({ kind: "awaitingRoll" });
    expect(chooseIntent(roll, "p0", () => 0)).toEqual({ type: "Roll", turn: 12 });
    expect(chooseIntent(roll, "p1", () => 0)).toBeNull();
    const offers = view({
      kind: "offer",
      field: 3,
      levels: [
        { level: 1, price: 1 },
        { level: 2, price: 2 },
      ],
      museum: 400_000,
    });
    expect(chooseIntent(offers, "p0", () => 0.999_999)).toEqual({
      type: "DeclineOffer",
      turn: 12,
    });
  });

  it("recognises the game-over phase", () => {
    expect(isGameOver(view({ kind: "gameOver", winner: "p0", reason: "timeUp" }))).toBe(true);
    expect(isGameOver(view({ kind: "awaitingRoll" }))).toBe(false);
    // Only a phase the view types can end the game: no invented "ended" id does.
    expect(isGameOver(view(unknownPhase("ended")))).toBe(false);
  });
});
