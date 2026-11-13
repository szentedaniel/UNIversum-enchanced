/**
 * Universities: the buy/build offer, Rent and the Buyout (R47–R52, R54–R56,
 * R58, F3, F24).
 *
 * Landing on an unowned or own University offers every Level the Player can
 * afford; buying one or declining ends the Turn. Landing on another Player's
 * University charges Rent to the owner, then offers the Buyout if the Player
 * can pay it. The Sale when cash can't cover the Rent (#29) hooks in here.
 */
import { MAX_LEVEL, type FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { buyoutPriceOf, fieldOwnerOf, rentOf, valueAt } from "#rules/pricing.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { recordMonopolies, recordPurchase } from "#rules/summary.ts";
import type { PlayerId } from "#state.ts";
import { decide, emit, playerById, type Tx } from "#tx.ts";

/** One Level on offer and what it costs: the Value difference from the current Level (R31). */
export type LevelOffer = { level: number; price: number };

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * The current Player may buy or build on the Field they landed on (R51),
     * or decline. `levels` lists only what they can afford, cheapest first.
     * `buyout`: another Player's University can be bought out at this price
     * (R52; `levels` is then empty). `museum`: the unowned Museum can be
     * bought at this price (R53; `levels` is then empty). Either key is
     * present only when that option is offered.
     */
    offer: { field: FieldId; levels: LevelOffer[]; buyout?: number; museum?: number };
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Buy the offered Field, or build it up, to `level` (R50). */
    BuyLevel: { level: number };
    /** Turn the offer down; the Turn passes (R20, R54). */
    DeclineOffer: {};
    /** Buy out another Player's University at the offered price (R52). */
    Buyout: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` bought or built `field` up to `level`, paying `price` to the Bank. */
    LevelBought: { player: PlayerId; field: FieldId; level: number; price: number };
    OfferDeclined: { player: PlayerId; field: FieldId };
    /** `player` paid `amount` Rent for `field` to its owner. */
    RentPaid: { player: PlayerId; owner: PlayerId; field: FieldId; amount: number };
    /** `player` bought `field` at `level` from `owner`, paying `owner` the `price` (R52, F3). */
    BoughtOut: { player: PlayerId; owner: PlayerId; field: FieldId; level: number; price: number };
  }
}

/**
 * The Levels the Player can buy on a Field at `level` with `cash` (R49, R50,
 * F24): any higher Level they can afford, except that Level 4 needs Level 3
 * first. A Level-4 University offers nothing (R48).
 */
export function levelOffers(field: FieldId, level: number, cash: number): LevelOffer[] {
  const offers: LevelOffer[] = [];
  for (let target = level + 1; target <= MAX_LEVEL; target++) {
    if (target === MAX_LEVEL && level !== MAX_LEVEL - 1) continue;
    const price = valueAt(field, target) - valueAt(field, level);
    if (price <= cash) offers.push({ level: target, price });
  }
  return offers;
}

/**
 * After the Rent: the Buyout of another Player's University, below Level 4 and
 * only if the Player's cash covers it (R48, R52). Nothing for a Bankrupt Player.
 */
export function offerBuyout(tx: Tx, playerId: PlayerId, field: FieldId): void {
  const player = playerById(tx, playerId);
  const level = tx.state.fields[field]?.level ?? 0;
  const buyout = buyoutPriceOf(tx.state, field);
  if (!player.bankrupt && level < MAX_LEVEL && buyout <= player.cash) {
    decide(tx, { kind: "offer", field, levels: [], buyout });
  }
}

/** Landing on a University (R13, R48, R49, R52, R56, R58). */
export const landOnUniversity: Landing = (tx, playerId, field) => {
  const { owner, level } = tx.state.fields[field] ?? { owner: null, level: 0 };
  if (owner !== null && owner !== playerId) {
    // Rent first (R56), whoever's Turn and wherever the owner stands (R47).
    // A Sale for the Rent (#29) stops here; the Buyout check then follows the Sale.
    charge(tx, playerId, { kind: "rent", amount: rentOf(tx.state, field), owner, field });
    if (!tx.decided) offerBuyout(tx, playerId, field);
    return;
  }
  // Own or unowned: no Rent (R58), only the offer.
  const levels = levelOffers(field, level, playerById(tx, playerId).cash);
  if (levels.length > 0) decide(tx, { kind: "offer", field, levels });
};

/** The offer phase the intent runs in. */
function offerOf(tx: Tx) {
  const { phase } = tx.state;
  if (phase.kind !== "offer") throw new Error(`no offer in phase ${phase.kind}`);
  return phase;
}

export const universityIntents = {
  BuyLevel: {
    actor: "player",
    phases: ["offer"],
    run(tx, intent) {
      const { field, levels } = offerOf(tx);
      const offer = levels.find((o) => o.level === intent.level);
      if (!offer) return rejection("NOT_OFFERED");
      const player = playerById(tx, tx.state.currentPlayer);
      const bought = (tx.state.fields[field]?.owner ?? null) === null;
      player.cash -= offer.price;
      tx.state.fields[field] = { owner: player.id, level: offer.level };
      if (bought) {
        recordPurchase(tx.state.summary, player.id);
        recordMonopolies(tx.state.summary, fieldOwnerOf(tx.state), player.id, [field]);
      }
      emit(tx, {
        type: "LevelBought",
        player: player.id,
        field,
        level: offer.level,
        price: offer.price,
      });
      passTurn(tx);
      return undefined;
    },
  },
  Buyout: {
    actor: "player",
    phases: ["offer"],
    run(tx) {
      const { field, buyout } = offerOf(tx);
      const fieldState = tx.state.fields[field];
      if (buyout === undefined || !fieldState?.owner) return rejection("NOT_OFFERED");
      const { owner, level } = fieldState;
      const player = playerById(tx, tx.state.currentPlayer);
      player.cash -= buyout;
      // The owner is paid whichever Seat they hold (F3 fixed).
      playerById(tx, owner).cash += buyout;
      // Only the owner changes: the Level stays, and so does a Doubler on it (R55).
      tx.state.fields[field] = { owner: player.id, level };
      recordPurchase(tx.state.summary, player.id);
      recordMonopolies(tx.state.summary, fieldOwnerOf(tx.state), player.id, [field]);
      emit(tx, { type: "BoughtOut", player: player.id, owner, field, level, price: buyout });
      passTurn(tx);
      return undefined;
    },
  },
  DeclineOffer: {
    actor: "player",
    phases: ["offer"],
    run(tx) {
      emit(tx, { type: "OfferDeclined", player: tx.state.currentPlayer, field: offerOf(tx).field });
      passTurn(tx);
    },
  },
} satisfies Partial<IntentHandlers>;
