import { describe, expect, it } from "vitest";
import {
  CHANCE_CARDS,
  publicView,
  ROUND_BONUS,
  START_CASH,
  SYSTEM,
  type Applied,
  type ChanceCardId,
  type GameState,
  type Seed,
} from "#index.ts";
import {
  accept,
  deadlineOf,
  newGame,
  player,
  playerOf,
  playTurn,
  rollOnto,
  withField,
  withPlayer,
} from "./helpers.ts";

const CHANCE = 14;

/** An integer hash: small or patterned raw seed words give correlated draws. */
function mix(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x7feb_352d);
  h = Math.imul(h ^ (h >>> 15), 0x846c_a68b);
  return h ^ (h >>> 16);
}

/** The i-th seed of a fixed series of well-mixed seeds. */
const seedNo = (i: number): Seed => [mix(4 * i), mix(4 * i + 1), mix(4 * i + 2), mix(4 * i + 3)];

/** The card of the `CardDrawn` event in an event list. */
function cardOf(applied: Applied): ChanceCardId {
  const drawn = applied.events.find((e) => e.type === "CardDrawn");
  if (!drawn) throw new Error("no CardDrawn event");
  return drawn.card;
}

/** The first Seat lands on Chance in a game with `seed`, after `last` was drawn. */
function draw(seed: Seed, last: ChanceCardId | null = null, start?: GameState): Applied {
  const state = start ?? newGame({ seed });
  return rollOnto({ ...state, lastChanceCard: last }, CHANCE);
}

/** The first seed (from the fixed series) whose first draw is `card`. */
function seedDrawing(card: ChanceCardId): Seed {
  for (let i = 1; i <= 1_000; i++) {
    if (cardOf(draw(seedNo(i))) === card) return seedNo(i);
  }
  throw new Error("no such seed in the search range");
}

/** How often each card is drawn over `n` seeded games, after `last`. */
function counts(n: number, last: ChanceCardId | null): Record<ChanceCardId, number> {
  const tally: Record<string, number> = Object.fromEntries(CHANCE_CARDS.map((c) => [c, 0]));
  for (let i = 1; i <= n; i++) {
    const card = cardOf(draw(seedNo(i), last));
    tally[card] = (tally[card] ?? 0) + 1;
  }
  return tally;
}

/** All the cash in the game. */
const totalCash = (state: GameState) => state.players.reduce((sum, p) => sum + p.cash, 0);

describe("the Chance draw", () => {
  it("R32: there are 9 cards: the PCR test, six money cards and the two movement cards", () => {
    expect(CHANCE_CARDS).toEqual([
      "pcrTest",
      "scholarship",
      "failedExams",
      "textbookFair",
      "teachingAssistantJob",
      "examPeriod",
      "scholarshipTransfer",
      "dormParty",
      "thesisPrinting",
    ]);
  });

  it("F17: a game starts with no last card", () => {
    expect(newGame().lastChanceCard).toBeNull();
  });

  it("R32, F17: the first draw of a game is uniform over all nine cards, the PCR card included", () => {
    const tally = counts(1_800, null);

    for (const card of CHANCE_CARDS) {
      expect(tally[card]).toBeGreaterThan(159);
      expect(tally[card]).toBeLessThan(241);
    }
  });

  it("R32: a draw never repeats the last card, and is uniform over the other eight", () => {
    for (const last of CHANCE_CARDS) {
      const tally = counts(1_200, last);

      expect(tally[last]).toBe(0);
      for (const card of CHANCE_CARDS.filter((c) => c !== last)) {
        expect(tally[card]).toBeGreaterThan(119);
        expect(tally[card]).toBeLessThan(181);
      }
    }
  });

  it("R32: the drawn card becomes the last card, and the draw comes from the seed", () => {
    const seed = seedDrawing("scholarship");

    const applied = draw(seed);

    expect(applied.state.lastChanceCard).toBe("scholarship");
    expect(cardOf(draw(seed))).toBe("scholarship");
    expect(applied.events).toContainEqual({ type: "CardDrawn", player: "p1", card: "scholarship" });
  });

  it("R33: the card applies at once with no confirmation, and the Turn passes", () => {
    const applied = draw(seedDrawing("scholarship"));

    expect(applied.events.map((e) => e.type)).toEqual([
      "DiceRolled",
      "Moved",
      "CardDrawn",
      "ChanceMoneyReceived",
      "TurnPassed",
    ]);
    expect(applied.state.phase.kind).toBe("awaitingRoll");
    expect(applied.state.currentPlayer).toBe("p2");
  });
});

describe("the PCR card", () => {
  it("R35: gives the Player a PCR test and nothing else", () => {
    const { state, events } = draw(seedDrawing("pcrTest"));

    expect(player(state, "p1")).toMatchObject({ hasPcrTest: true, cash: START_CASH });
    expect(events.map((e) => e.type)).toEqual(["DiceRolled", "Moved", "CardDrawn", "TurnPassed"]);
  });

  it("R35, F23: a Player holds at most one PCR test, so a second card is wasted", () => {
    const seed = seedDrawing("pcrTest");
    const start = withPlayer(newGame({ seed }), "p1", { hasPcrTest: true });

    const { state } = draw(seed, null, start);

    expect(player(state, "p1").hasPcrTest).toBe(true);
    expect(JSON.stringify(state)).toBe(JSON.stringify(draw(seed).state));
  });

  it("R35, ADR-0005: the PCR test isn't in the CardDrawn reveal and is in the final view", () => {
    const applied = draw(seedDrawing("pcrTest"));
    const drawn = applied.events.findIndex((event) => event.type === "CardDrawn");
    const at = applied.reveals[drawn];
    const next = applied.reveals[drawn + 1];
    if (!at || !next) throw new Error("the draw or the event after it is missing");

    // The card has no event of its own: it shows with the next event (the Turn passing)…
    expect(playerOf(at, "p1").hasPcrTest).toBe(false);
    expect(playerOf(next, "p1").hasPcrTest).toBe(true);
    // …and the final view carries it.
    expect(playerOf(publicView(applied.state), "p1").hasPcrTest).toBe(true);
  });
});

describe("money cards", () => {
  it("R34: the +200,000 card is paid by the Bank", () => {
    const { state, events } = draw(seedDrawing("scholarship"));

    expect(events).toContainEqual({ type: "ChanceMoneyReceived", player: "p1", amount: 200_000 });
    expect(player(state, "p1").cash).toBe(START_CASH + 200_000);
    expect(totalCash(state)).toBe(totalCash(newGame()) + 200_000);
  });

  it("R34, F6: the −200,000 card is charged, to the Bank", () => {
    const { state, events } = draw(seedDrawing("failedExams"));

    expect(events).toContainEqual({ type: "ChanceChargePaid", player: "p1", amount: 200_000 });
    expect(player(state, "p1").cash).toBe(START_CASH - 200_000);
    expect(totalCash(state)).toBe(totalCash(newGame()) - 200_000);
  });

  it("R34, R70: a Player who can't cover the −200,000 card with cash or Fields pays what they have and is Bankrupt", () => {
    const seed = seedDrawing("failedExams");
    const start = withPlayer(newGame({ seed }), "p1", { cash: 50_000 });

    const { state, events } = draw(seed, null, start);

    expect(events).toContainEqual({ type: "ChanceChargePaid", player: "p1", amount: 50_000 });
    expect(events).toContainEqual({ type: "WentBankrupt", player: "p1", fields: [] });
    expect(player(state, "p1")).toMatchObject({ cash: 0, bankrupt: true });
  });

  it("R34, F6: a Player who can cover the −200,000 card only by selling goes into a Sale for the Shortfall", () => {
    const seed = seedDrawing("failedExams");
    let start = withPlayer(newGame({ seed }), "p1", { cash: 50_000 });
    start = withField(start, 1, { owner: "p1", level: 1 }); // Veszprém, sale 180,000

    const { state } = draw(seed, null, start);

    expect(state.phase).toEqual({
      kind: "selling",
      shortfall: 150_000,
      resume: { kind: "chanceCard", amount: 200_000 },
    });
  });
});

describe("the Textbook fair card", () => {
  it("R34: charges 150,000 to the Bank", () => {
    const { state, events } = draw(seedDrawing("textbookFair"));

    expect(events).toContainEqual({ type: "ChanceChargePaid", player: "p1", amount: 150_000 });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "ChanceMoneyReceived" }));
    expect(player(state, "p1").cash).toBe(START_CASH - 150_000);
    expect(totalCash(state)).toBe(totalCash(newGame()) - 150_000);
  });

  it("R34, F6: a Player who can cover it only by selling goes into a Sale for the Shortfall", () => {
    const seed = seedDrawing("textbookFair");
    let start = withPlayer(newGame({ seed }), "p1", { cash: 50_000 });
    start = withField(start, 1, { owner: "p1", level: 1 }); // Veszprém, sale 180,000

    const { state } = draw(seed, null, start);

    expect(state.phase).toEqual({
      kind: "selling",
      shortfall: 100_000,
      resume: { kind: "chanceCard", amount: 150_000 },
    });
  });

  it("R34, R70: a Player who can't cover it with cash or Fields pays what they have and is Bankrupt", () => {
    const seed = seedDrawing("textbookFair");
    const start = withPlayer(newGame({ seed }), "p1", { cash: 50_000 });

    const { state, events } = draw(seed, null, start);

    expect(events).toContainEqual({ type: "ChanceChargePaid", player: "p1", amount: 50_000 });
    expect(events).toContainEqual({ type: "WentBankrupt", player: "p1", fields: [] });
    expect(player(state, "p1")).toMatchObject({ cash: 0, bankrupt: true });
  });
});

describe("the Teaching assistant job card", () => {
  it("R34: the Bank pays 300,000", () => {
    const { state, events } = draw(seedDrawing("teachingAssistantJob"));

    expect(events).toContainEqual({
      type: "ChanceMoneyReceived",
      player: "p1",
      amount: 300_000,
    });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "ChanceChargePaid" }));
    expect(player(state, "p1").cash).toBe(START_CASH + 300_000);
    expect(totalCash(state)).toBe(totalCash(newGame()) + 300_000);
  });
});

describe("the Exam period card", () => {
  it("R34, R39: sends the Player to the Quarantine Field for 3 rounds, with no Round bonus", () => {
    const applied = draw(seedDrawing("examPeriod"));
    const drawn = applied.events.findIndex((event) => event.type === "CardDrawn");
    const before = applied.reveals[drawn];
    if (!before) throw new Error("the draw's reveal is missing");

    expect(applied.events.slice(drawn + 1)).toEqual([
      { type: "Moved", player: "p1", from: CHANCE, to: 8, steps: 26 },
      { type: "QuarantineEntered", player: "p1", rounds: 3 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(applied.state, "p1")).toMatchObject({
      position: 8,
      quarantineRounds: 3,
      cash: playerOf(before, "p1").cash,
    });
  });

  it("R34, R41: the usual Quarantine rules follow, a held PCR test included", () => {
    const seed = seedDrawing("examPeriod");
    const start = withPlayer(newGame({ seed, players: 2 }), "p1", { hasPcrTest: true });

    const applied = draw(seed, null, start);
    const next = playTurn(applied.state);

    // p2's Turn passes; p1's starts in Quarantine, with the usual choice.
    expect(next.state.currentPlayer).toBe("p1");
    expect(next.state.phase).toEqual({
      kind: "quarantineChoice",
      canBuyPcrTest: true,
      canUsePcrTest: true,
      pcrTestPrice: 200_000,
    });
  });
});

describe("the Scholarship transfer card", () => {
  it("R34, R73: moves the Player to Start and pays the Round bonus", () => {
    const applied = draw(seedDrawing("scholarshipTransfer"));
    const drawn = applied.events.findIndex((event) => event.type === "CardDrawn");
    const before = applied.reveals[drawn];
    if (!before) throw new Error("the draw's reveal is missing");
    const beforeCash = playerOf(before, "p1").cash;

    expect(applied.events.slice(drawn + 1)).toEqual([
      { type: "Moved", player: "p1", from: CHANCE, to: 0, steps: 18 },
      { type: "RoundBonusPaid", player: "p1", amount: ROUND_BONUS },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(applied.state, "p1")).toMatchObject({
      position: 0,
      cash: beforeCash + ROUND_BONUS,
    });
  });
});

// Veszprém at Level 1: the Bank pays 180,000 for it in a Sale.
const VESZPREM = 1;

/** A 3-Player game whose second Seat is short of 50,000 and holds Veszprém. */
function dormPartyWithShortPayer(seed: Seed): GameState {
  let start = newGame({ seed, players: 3 });
  start = withPlayer(start, "p2", { cash: 10_000 });
  return withField(start, VESZPREM, { owner: "p2", level: 1 });
}

describe("the Dorm party card", () => {
  it("R34: every other Player pays the drawer 50,000, each payment its own event and reveal", () => {
    const applied = draw(seedDrawing("dormParty"));
    const drawn = applied.events.findIndex((event) => event.type === "CardDrawn");
    const payments = applied.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === "ChanceTransferPaid");

    expect(applied.events.slice(drawn + 1)).toEqual([
      { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p4", payee: "p1", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    // Each payment shows on the Board at its own step: the payer's cash drops
    // there, and the earlier Payers keep what they paid.
    const [first, second, third] = payments.map(({ index }) => applied.reveals[index]);
    if (!first || !second || !third) throw new Error("a payment's reveal is missing");
    expect(playerOf(first, "p1").cash).toBe(START_CASH + 50_000);
    expect(playerOf(first, "p2").cash).toBe(START_CASH - 50_000);
    expect(playerOf(second, "p3").cash).toBe(START_CASH - 50_000);
    expect(playerOf(third, "p4").cash).toBe(START_CASH - 50_000);

    expect(player(applied.state, "p1").cash).toBe(START_CASH + 150_000);
    expect(totalCash(applied.state)).toBe(totalCash(newGame()));
  });

  it("R34, R66: a payer short of cash sells a Field, then the card carries on with the rest", () => {
    const seed = seedDrawing("dormParty");
    const sale = draw(seed, null, dormPartyWithShortPayer(seed));

    expect(sale.state.currentPlayer).toBe("p2");
    expect(sale.state.phase).toEqual({
      kind: "selling",
      shortfall: 40_000,
      resume: {
        kind: "chanceTransfer",
        amount: 50_000,
        payee: "p1",
        actor: "p1",
        rest: [{ payer: "p3", payee: "p1", amount: 50_000 }],
      },
    });
    // Nothing is paid until the Sale.
    expect(sale.events.some((event) => event.type === "ChanceTransferPaid")).toBe(false);

    const done = accept(
      sale.state,
      { type: "SellFields", turn: sale.state.turn, fields: [VESZPREM] },
      "p2",
    );

    expect(done.events).toEqual([
      { type: "FieldsSold", player: "p2", fields: [VESZPREM], amount: 180_000, auto: false },
      { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(done.state, "p2").cash).toBe(140_000);
    expect(player(done.state, "p1").cash).toBe(START_CASH + 100_000);
    expect(done.state.currentPlayer).toBe("p2");
  });

  it("R34, R68: Auto-sell covers the payer's Shortfall and the card carries on", () => {
    const seed = seedDrawing("dormParty");
    const sale = draw(seed, null, dormPartyWithShortPayer(seed));

    const done = accept(sale.state, { type: "AutoSell", turn: sale.state.turn }, "p2");

    expect(done.events).toEqual([
      { type: "FieldsSold", player: "p2", fields: [VESZPREM], amount: 180_000, auto: true },
      { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
  });

  it("R34, R70: a payer who can't cover it with cash or Fields pays what they have and is Bankrupt", () => {
    const seed = seedDrawing("dormParty");
    const start = withPlayer(newGame({ seed, players: 3 }), "p2", { cash: 10_000 });

    const { state, events } = draw(seed, null, start);
    const drawn = events.findIndex((event) => event.type === "CardDrawn");

    expect(events.slice(drawn + 1)).toEqual([
      { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 10_000 },
      { type: "WentBankrupt", player: "p2", fields: [] },
      { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 50_000 },
      // The Bankrupt Player is skipped in turn order (R14).
      { type: "TurnPassed", player: "p3", turn: 2 },
    ]);
    expect(player(state, "p1").cash).toBe(START_CASH + 60_000);
    expect(player(state, "p2")).toMatchObject({ cash: 0, bankrupt: true });
  });

  it("R69: a payer's timed-out Sale auto-sells and the card carries on, with no Timeout penalty", () => {
    const seed = seedDrawing("dormParty");
    const sale = draw(seed, null, dormPartyWithShortPayer(seed));

    const done = accept(
      sale.state,
      { type: "TurnTimedOut", turn: sale.state.turn },
      SYSTEM,
      deadlineOf(sale.state),
    );

    expect(done.events).toEqual([
      { type: "TimedOut", player: "p2" },
      { type: "FieldsSold", player: "p2", fields: [VESZPREM], amount: 180_000, auto: true },
      { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(done.events).not.toContainEqual(expect.objectContaining({ type: "TimeoutPenaltyPaid" }));
  });
});

describe("the Thesis printing card", () => {
  it("R34: the drawer pays every other Player 50,000, each payment its own event", () => {
    const applied = draw(seedDrawing("thesisPrinting"));
    const drawn = applied.events.findIndex((event) => event.type === "CardDrawn");

    expect(applied.events.slice(drawn + 1)).toEqual([
      { type: "ChanceTransferPaid", player: "p1", payee: "p2", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p1", payee: "p3", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p1", payee: "p4", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(applied.state, "p1").cash).toBe(START_CASH - 150_000);
    for (const id of ["p2", "p3", "p4"]) {
      expect(player(applied.state, id).cash).toBe(START_CASH + 50_000);
    }
    expect(totalCash(applied.state)).toBe(totalCash(newGame()));
  });

  it("R34, R66: a drawer short of cash sells a Field, then the card carries on with the rest", () => {
    const seed = seedDrawing("thesisPrinting");
    let start = newGame({ seed, players: 3 });
    start = withPlayer(start, "p1", { cash: 10_000 });
    start = withField(start, VESZPREM, { owner: "p1", level: 1 });

    const sale = draw(seed, null, start);

    expect(sale.state.currentPlayer).toBe("p1");
    expect(sale.state.phase).toEqual({
      kind: "selling",
      shortfall: 40_000,
      resume: {
        kind: "chanceTransfer",
        amount: 50_000,
        payee: "p2",
        actor: "p1",
        rest: [{ payer: "p1", payee: "p3", amount: 50_000 }],
      },
    });

    const done = accept(sale.state, { type: "AutoSell", turn: sale.state.turn }, "p1");

    expect(done.events).toEqual([
      { type: "FieldsSold", player: "p1", fields: [VESZPREM], amount: 180_000, auto: true },
      { type: "ChanceTransferPaid", player: "p1", payee: "p2", amount: 50_000 },
      { type: "ChanceTransferPaid", player: "p1", payee: "p3", amount: 50_000 },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(done.state, "p1").cash).toBe(90_000);
    expect(player(done.state, "p2").cash).toBe(START_CASH + 50_000);
    expect(player(done.state, "p3").cash).toBe(START_CASH + 50_000);
  });

  it("R34, R70: a drawer who can't cover it with cash or Fields is Bankrupt and pays no further Player", () => {
    const seed = seedDrawing("thesisPrinting");
    const start = withPlayer(newGame({ seed, players: 3 }), "p1", { cash: 0 });

    const { state, events } = draw(seed, null, start);
    const drawn = events.findIndex((event) => event.type === "CardDrawn");

    expect(events.slice(drawn + 1)).toEqual([
      { type: "ChanceTransferPaid", player: "p1", payee: "p2", amount: 0 },
      { type: "WentBankrupt", player: "p1", fields: [] },
      { type: "TurnPassed", player: "p2", turn: 2 },
    ]);
    expect(player(state, "p1")).toMatchObject({ cash: 0, bankrupt: true });
    expect(player(state, "p2").cash).toBe(START_CASH);
    expect(player(state, "p3").cash).toBe(START_CASH);
  });
});
