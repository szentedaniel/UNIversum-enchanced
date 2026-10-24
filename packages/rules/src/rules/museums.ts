/**
 * Museums: the buy offer and Rent (R53, F2).
 *
 * Landing on an unowned Museum offers it for its Value if the Player can
 * afford it; buying or declining ends the Turn. An owned Museum charges only
 * Rent (to another Player), then the Turn passes. Museums have no Levels and
 * can't be bought out.
 */
import { MUSEUM_VALUE, type FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { rentOf } from "#rules/pricing.ts";
import type { PlayerId } from "#state.ts";
import { decide, emit, playerById } from "#tx.ts";

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Buy the offered Museum (R53). */
    BuyMuseum: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` bought the Museum `field`, paying `price` to the Bank. */
    MuseumBought: { player: PlayerId; field: FieldId; price: number };
  }
}

/** Landing on a Museum (R53, R56, R58). */
export const landOnMuseum: Landing = (tx, playerId, field) => {
  const owner = tx.state.fields[field]?.owner ?? null;
  if (owner === null) {
    if (playerById(tx, playerId).cash >= MUSEUM_VALUE) {
      decide(tx, { kind: "offer", field, levels: [], museum: MUSEUM_VALUE });
    }
    return;
  }
  if (owner === playerId) return; // Own Museum: no Rent (R58), nothing to buy.
  charge(tx, playerId, { kind: "rent", amount: rentOf(tx.state, field), owner, field });
};

export const museumIntents = {
  BuyMuseum: {
    actor: "player",
    phases: ["offer"],
    run(tx) {
      const { phase } = tx.state;
      if (phase.kind !== "offer" || phase.museum === undefined) return rejection("NOT_OFFERED");
      const player = playerById(tx, tx.state.currentPlayer);
      player.cash -= phase.museum;
      tx.state.fields[phase.field] = { owner: player.id, level: 0 };
      emit(tx, {
        type: "MuseumBought",
        player: player.id,
        field: phase.field,
        price: phase.museum,
      });
      passTurn(tx);
      return undefined;
    },
  },
} satisfies Partial<IntentHandlers>;
