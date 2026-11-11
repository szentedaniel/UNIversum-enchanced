/**
 * Chance (R32–R35, F17, F23, F6): landing on a Chance Field draws one card
 * from the game's PRNG, never the last card drawn, and the card takes effect
 * at once with no confirmation (R33).
 */
import {
  CHANCE_CARD_MONEY,
  CHANCE_CARDS,
  FIELD_COUNT,
  QUARANTINE_FIELD,
  START_FIELD,
  type ChanceCardId,
  type FieldId,
} from "#board.ts";
import { randomInt } from "#rng.ts";
import { payTransfers } from "#rules/chance-transfer.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { moveForward, moveForwardWithoutRoundBonus } from "#rules/movement.ts";
import { enterQuarantine } from "#rules/quarantine.ts";
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

/** The Bank pays the drawer `amount` (the scholarship and the teaching assistant job). */
function bankPays(tx: Tx, playerId: PlayerId, amount: number): void {
  playerById(tx, playerId).cash += amount;
  emit(tx, { type: "ChanceMoneyReceived", player: playerId, amount });
}

/** A Charge to the Bank like any other (F6: v1 never took this money). */
function bankCharges(tx: Tx, playerId: PlayerId, amount: number): void {
  charge(tx, playerId, { kind: "chanceCard", amount });
}

/** The Fields from the Player's current Field forward to `field`. */
function stepsTo(tx: Tx, playerId: PlayerId, field: FieldId): number {
  return (field - playerById(tx, playerId).position + FIELD_COUNT) % FIELD_COUNT;
}

/** The other Players still in the game, in Seat order. */
function othersOf(tx: Tx, playerId: PlayerId): PlayerId[] {
  return tx.state.players
    .filter((player) => player.id !== playerId && !player.bankrupt)
    .map((player) => player.id);
}

/** What each card does to the Player who drew it. */
const EFFECTS: Record<ChanceCardId, (tx: Tx, playerId: PlayerId) => void> = {
  // A flag, not a count: a second card is wasted (F23).
  pcrTest: (tx, playerId) => {
    playerById(tx, playerId).hasPcrTest = true;
  },
  scholarship: (tx, playerId) => bankPays(tx, playerId, CHANCE_CARD_MONEY.scholarship),
  failedExams: (tx, playerId) => bankCharges(tx, playerId, -CHANCE_CARD_MONEY.failedExams),
  textbookFair: (tx, playerId) => bankCharges(tx, playerId, -CHANCE_CARD_MONEY.textbookFair),
  teachingAssistantJob: (tx, playerId) =>
    bankPays(tx, playerId, CHANCE_CARD_MONEY.teachingAssistantJob),
  // The walk shows, but passing Start pays nothing: the card is a setback (R34, R39).
  examPeriod: (tx, playerId) => {
    moveForwardWithoutRoundBonus(tx, playerId, stepsTo(tx, playerId, QUARANTINE_FIELD));
    enterQuarantine(tx, playerId);
  },
  // The same payment as passing Start, through `moveForward` (R34, R73).
  scholarshipTransfer: (tx, playerId) => {
    moveForward(tx, playerId, stepsTo(tx, playerId, START_FIELD));
  },
  // Every other Player pays the drawer, each payment a Charge to the drawer (R34, R57).
  dormParty: (tx, playerId) => {
    const amount = CHANCE_CARD_MONEY.dormParty;
    const payments = othersOf(tx, playerId).map((payer) => ({ payer, payee: playerId, amount }));
    payTransfers(tx, playerId, payments);
  },
  // The drawer pays every other Player, each payment a Charge from the drawer (R34, R57).
  thesisPrinting: (tx, playerId) => {
    const amount = -CHANCE_CARD_MONEY.thesisPrinting;
    const payments = othersOf(tx, playerId).map((payee) => ({ payer: playerId, payee, amount }));
    payTransfers(tx, playerId, payments);
  },
};

/** Landing on Chance: draw, show, apply (R32, R33). */
export const landOnChance: Landing = (tx, playerId) => {
  const card = drawCard(tx);
  emit(tx, { type: "CardDrawn", player: playerId, card });
  EFFECTS[card](tx, playerId);
};
