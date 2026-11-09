/**
 * The Doubler corner (R59–R63, F10, F11): landing on it offers the Player one
 * of their own Universities or Museums; the one Doubler token moves there and
 * stacks when placed again on the same Field. `doublerPlacement` is that
 * placement rule, shared by the intent and `publicView`; Rent on its Field is
 * in `pricing.ts`, and a sold or Bankrupt Field loses it in `charge.ts` (R62).
 */
import { FIELDS, type FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import type { Landing } from "#rules/landing.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { rentOf, rentWithCount } from "#rules/pricing.ts";
import type { GameState, PlayerId } from "#state.ts";
import { decide, emit, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /** The current Player picks one of their own Fields for the Doubler (R59). */
    placingDoubler: { fields: FieldId[] };
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Put the one Doubler on one of the offered Fields (R59, R60). */
    PlaceDoubler: { field: FieldId };
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` put the Doubler on `field`; `count` is the stack there now (R60). */
    DoublerPlaced: { player: PlayerId; field: FieldId; count: number };
  }
}

/** The Player's own Universities and Museums, in Field order (R59). */
export function doublerTargets(state: GameState, playerId: PlayerId): FieldId[] {
  return FIELDS.filter(
    (field) =>
      (field.kind === "university" || field.kind === "museum") &&
      state.fields[field.id]?.owner === playerId,
  ).map((field) => field.id);
}

/** The effect of placing the token on `field`: the stack it leaves and the Rent before and after. */
export type DoublerPlacement = { count: number; rent: number; rentAfter: number };

/**
 * The one rule of a Doubler placement (R60, R61, F11): on the Field that
 * already carries the token the count stacks, anywhere else it moves with
 * count 1, and the Rent is what the Field charges now and once it is there.
 */
export function doublerPlacement(state: GameState, field: FieldId): DoublerPlacement {
  const count = (state.doubler?.field === field ? state.doubler.count : 0) + 1;
  return { count, rent: rentOf(state, field), rentAfter: rentWithCount(state, field, count) };
}

/** Landing on the Doubler Field: a pick with at least one own Field, else nothing (R59). */
export const landOnDoubler: Landing = (tx, playerId) => {
  const fields = doublerTargets(tx.state, playerId);
  if (fields.length > 0) decide(tx, { kind: "placingDoubler", fields });
};

export const doublerIntents = {
  PlaceDoubler: {
    actor: "player",
    phases: ["placingDoubler"],
    run(tx: Tx, intent) {
      const { phase } = tx.state;
      if (phase.kind !== "placingDoubler" || !phase.fields.includes(intent.field)) {
        return rejection("NOT_OFFERED");
      }
      // One token on the Board: the same Field stacks, any other moves it (R60, F11).
      const { count } = doublerPlacement(tx.state, intent.field);
      tx.state.doubler = { field: intent.field, count };
      emit(tx, {
        type: "DoublerPlaced",
        player: tx.state.currentPlayer,
        field: intent.field,
        count,
      });
      passTurn(tx);
      return undefined;
    },
  },
} satisfies Partial<IntentHandlers>;
