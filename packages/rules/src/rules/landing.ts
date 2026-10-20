/**
 * What happens when a move ends on a Field, by Field kind (R13). A landing
 * either finishes on its own (the Turn then passes) or stops at a Player
 * decision with `decide(tx, phase)`.
 *
 * Each rule area replaces its own entry: Universities (#26), Museums (#27),
 * Chance and Tax (#28), Quarantine (#30), Doubler and Erasmus (#31).
 */
import { FIELDS, type FieldId, type FieldKind } from "#board.ts";
import { enterQuarantine } from "#rules/quarantine.ts";
import { landOnUniversity } from "#rules/universities.ts";
import type { PlayerId } from "#state.ts";
import { playerById, type Tx } from "#tx.ts";

export type Landing = (tx: Tx, player: PlayerId, field: FieldId) => void;

const nothing: Landing = () => {};

const LANDINGS: Record<FieldKind, Landing> = {
  start: nothing,
  university: landOnUniversity,
  museum: nothing,
  chance: nothing,
  tax: nothing,
  quarantine: enterQuarantine,
  doubler: nothing,
  erasmus: nothing,
};

/** Runs the effect of the Field the Player stands on. */
export function landOn(tx: Tx, playerId: PlayerId): void {
  const field = playerById(tx, playerId).position;
  const info = FIELDS[field];
  if (!info) throw new Error(`no Field ${field}`);
  LANDINGS[info.kind](tx, playerId, field);
}
