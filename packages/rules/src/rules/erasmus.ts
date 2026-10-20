/**
 * The Erasmus corner (R64, R65, F16): landing on it offers every University or
 * Museum no other Player owns; the Player travels forward to the chosen Field
 * (the Round bonus applies when the route passes Start) and lands normally.
 * With nothing to pick the Turn passes at once, with no penalty.
 *
 * The intent handler lives in `erasmus-travel.ts`: it needs `landOn`, and
 * `landing.ts` imports this module, so importing it back would be a cycle.
 */
import { FIELDS, type FieldId } from "#board.ts";
import type { Landing } from "#rules/landing.ts";
import type { GameState, PlayerId } from "#state.ts";
import { decide, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /** The current Player picks an Erasmus destination (R64). */
    choosingErasmus: { fields: FieldId[] };
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Travel forward to one of the offered Fields and land there (R65). */
    TravelErasmus: { field: FieldId };
  }
}

/** Every University and Museum no other Player owns: unowned or the Player's own (R64). */
export function erasmusTargets(state: GameState, playerId: PlayerId): FieldId[] {
  return FIELDS.filter((field) => {
    if (field.kind !== "university" && field.kind !== "museum") return false;
    const owner = state.fields[field.id]?.owner ?? null;
    return owner === null || owner === playerId;
  }).map((field) => field.id);
}

/** Landing on Erasmus: a pick when something is free or the Player's, else nothing (R64, F16). */
export const landOnErasmus: Landing = (tx: Tx, playerId) => {
  const fields = erasmusTargets(tx.state, playerId);
  if (fields.length > 0) decide(tx, { kind: "choosingErasmus", fields });
};
