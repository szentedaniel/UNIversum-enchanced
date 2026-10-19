/**
 * Universities: the buy/build offer, and Rent (R47–R51, R54, R56, R58, F24).
 *
 * Landing on an unowned or own University offers every Level the Player can
 * afford; buying one or declining ends the Turn. Landing on another Player's
 * University charges Rent to the owner. The Buyout (#27) and the Sale when
 * cash can't cover the Rent (#29) hook in here.
 */
import { MAX_LEVEL, type FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { rentOf, valueAt } from "#rules/pricing.ts";
import { passTurn } from "#rules/pass-turn.ts";
import type { PlayerId } from "#state.ts";
import { decide, emit, playerById, type Tx } from "#tx.ts";

/** One Level on offer and what it costs: the Value difference from the current Level (R31). */
export type LevelOffer = { level: number; price: number };

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * The current Player may buy or build on the Field they landed on (R51),
     * or decline. `levels` lists only what they can afford, cheapest first.
     */
    offer: { field: FieldId; levels: LevelOffer[] };
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Buy the offered Field, or build it up, to `level` (R50). */
    BuyLevel: { level: number };
    /** Turn the offer down; the Turn passes (R20, R54). */
    DeclineOffer: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` bought or built `field` up to `level`, paying `price` to the Bank. */
    LevelBought: { player: PlayerId; field: FieldId; level: number; price: number };
    OfferDeclined: { player: PlayerId; field: FieldId };
    /** `player` paid `amount` Rent for `field` to its owner. */
    RentPaid: { player: PlayerId; owner: PlayerId; field: FieldId; amount: number };
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

/** Landing on a University (R13, R48, R49, R56, R58). */
export const landOnUniversity: Landing = (tx, playerId, field) => {
  const { owner, level } = tx.state.fields[field] ?? { owner: null, level: 0 };
  if (owner !== null && owner !== playerId) {
    // Rent first (R56), whoever's Turn and wherever the owner stands (R47).
    charge(tx, playerId, rentOf(tx.state, field), (amount) => {
      playerById(tx, owner).cash += amount;
      emit(tx, { type: "RentPaid", player: playerId, owner, field, amount });
    });
    return; // The Buyout offer comes here (#27).
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
      player.cash -= offer.price;
      tx.state.fields[field] = { owner: player.id, level: offer.level };
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
  DeclineOffer: {
    actor: "player",
    phases: ["offer"],
    run(tx) {
      emit(tx, { type: "OfferDeclined", player: tx.state.currentPlayer, field: offerOf(tx).field });
      passTurn(tx);
    },
  },
} satisfies Partial<IntentHandlers>;
