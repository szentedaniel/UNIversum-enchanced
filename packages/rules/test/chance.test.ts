import { describe, expect, it } from "vitest";
import {
  CHANCE_CARDS,
  publicView,
  ROUND_BONUS,
  START_CASH,
  type Applied,
  type ChanceCardId,
  type GameState,
  type Seed,
} from "#index.ts";
import { newGame, player, playerOf, playTurn, rollOnto, withField, withPlayer } from "./helpers.ts";

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
  it("R32: there are 7 cards: the PCR test, four money cards and the two movement cards", () => {
    expect(CHANCE_CARDS).toEqual([
      "pcrTest",
      "scholarship",
      "failedExams",
      "textbookFair",
      "teachingAssistantJob",
      "examPeriod",
      "scholarshipTransfer",
    ]);
  });

  it("F17: a game starts with no last card", () => {
    expect(newGame().lastChanceCard).toBeNull();
  });

  it("R32, F17: the first draw of a game is uniform over all seven cards, the PCR card included", () => {
    const tally = counts(900, null);

    for (const card of CHANCE_CARDS) {
      expect(tally[card]).toBeGreaterThan(96);
      expect(tally[card]).toBeLessThan(161);
    }
  });

  it("R32: a draw never repeats the last card, and is uniform over the other six", () => {
    for (const last of CHANCE_CARDS) {
      const tally = counts(600, last);

      expect(tally[last]).toBe(0);
      for (const card of CHANCE_CARDS.filter((c) => c !== last)) {
        expect(tally[card]).toBeGreaterThan(79);
        expect(tally[card]).toBeLessThan(121);
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
