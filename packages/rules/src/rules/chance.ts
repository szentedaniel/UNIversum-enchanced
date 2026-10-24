/**
 * Chance (R32–R35, F17, F23, F6): landing on a Chance Field draws one of the
 * 3 cards from the game's PRNG, never the last card drawn, and the card takes
 * effect at once with no confirmation (R33).
 */
import { CHANCE_CARD_MONEY, CHANCE_CARDS, type ChanceCardId } from "#board.ts";
import { randomInt } from "#rng.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import type { PlayerId } from "#state.ts";
import { emit, playerById, type Tx } from "#tx.ts";

declare module "#events.ts" {
  interface EventMap {
    /** `player` drew `card`; its effect follows as its own event (if any). */
    CardDrawn: { player: PlayerId; card: ChanceCardId };
    /** The Bank paid `player` `amount` for a Chance card. */
    ChanceMoneyReceived: { player: PlayerId; amount: number };
    /** `player` paid `amount` to the Bank for a Chance card (a Charge). */
    ChanceChargePaid: { player: PlayerId; amount: number };
  }
}

/**
 * Draws a card uniformly from the cards other than the last one drawn (R32);
 * the first draw of a game can be any card (F17).
 */
function drawCard(tx: Tx): ChanceCardId {
  const { lastChanceCard } = tx.state;
  const cards = CHANCE_CARDS.filter((card) => card !== lastChanceCard);
  const card = cards[randomInt(tx, 0, cards.length - 1)];
  if (!card) throw new Error("no Chance card to draw");
  tx.state.lastChanceCard = card;
  return card;
}

/** What each card does to the Player who drew it. */
const EFFECTS: Record<ChanceCardId, (tx: Tx, player: PlayerId) => void> = {
  // A flag, not a count: a second card is wasted (F23).
  pcrTest: (tx, playerId) => {
    playerById(tx, playerId).hasPcrTest = true;
  },
  scholarship: (tx, playerId) => {
    const amount = CHANCE_CARD_MONEY.scholarship;
    playerById(tx, playerId).cash += amount;
    emit(tx, { type: "ChanceMoneyReceived", player: playerId, amount });
  },
  // A Charge like any other (F6: v1 never took this money).
  failedExams: (tx, playerId) => {
    charge(tx, playerId, { kind: "chanceCard", amount: -CHANCE_CARD_MONEY.failedExams });
  },
};

/** Landing on Chance: draw, show, apply (R32, R33). */
export const landOnChance: Landing = (tx, playerId) => {
  const card = drawCard(tx);
  emit(tx, { type: "CardDrawn", player: playerId, card });
  EFFECTS[card](tx, playerId);
};
