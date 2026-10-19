/**
 * What a Field is worth and what it charges, from the static Board data and
 * the current state (R26–R31). Pure functions of the state, shared by the rule
 * areas and `publicView`. Museums (#27) and the Doubler (#31) extend `valueOf`
 * and `rentOf`.
 */
import { FIELDS, type FieldId, type GroupId } from "#board.ts";
import type { GameState } from "#state.ts";

/** Rent as a percentage of Value, by Level 1–4 (R28). */
const RENT_PERCENT = [0, 55, 70, 85, 100] as const;

/** A Monopoly multiplies Rent by 1.4 (R29), kept as tenths so amounts stay whole. */
const MONOPOLY_TENTHS = 14;

/** A University's Value at `level` (R27); 0 for any other Field. */
export function valueAt(field: FieldId, level: number): number {
  return FIELDS[field]?.values?.[level] ?? 0;
}

/** A Field's Value at its current Level. */
export function valueOf(state: GameState, field: FieldId): number {
  return valueAt(field, state.fields[field]?.level ?? 0);
}

/** True when one Player owns every University of the Group (R29, F1). */
export function isMonopoly(state: GameState, group: GroupId): boolean {
  const owners = FIELDS.filter((f) => f.group === group).map((f) => state.fields[f.id]?.owner);
  const [first] = owners;
  return first != null && owners.every((owner) => owner === first);
}

/** What a Player other than the owner pays on landing here now; 0 when unowned. */
export function rentOf(state: GameState, field: FieldId): number {
  const info = FIELDS[field];
  const fieldState = state.fields[field];
  if (!info?.group || !fieldState?.owner) return 0;
  const rent = (valueOf(state, field) * (RENT_PERCENT[fieldState.level] ?? 0)) / 100;
  return Math.round(isMonopoly(state, info.group) ? (rent * MONOPOLY_TENTHS) / 10 : rent);
}
