/**
 * What a Field is worth and what it charges, from the static Board data and
 * the current state (R26–R31, R53, F2). Pure functions of the state, shared by
 * the rule areas and `publicView`. The Doubler (#31) extends `rentOf`.
 */
import { FIELDS, MUSEUM_VALUE, type FieldId, type GroupId } from "#board.ts";
import type { GameState } from "#state.ts";

/** Rent as a percentage of Value, by Level 1–4 (R28). */
const RENT_PERCENT = [0, 55, 70, 85, 100] as const;

/** A Monopoly multiplies Rent by 1.4 (R29), kept as tenths so amounts stay whole. */
const MONOPOLY_TENTHS = 14;

/** A Museum's Rent per Museum its owner holds (R53). */
const MUSEUM_RENT_STEP = 75_000;

/** A Bank sale pays 90% of Value; a Buyout costs 200% (R30). */
const SALE_PERCENT = 90;
const BUYOUT_PERCENT = 200;

/** A University's Value at `level` (R27); 0 for any other Field. */
export function valueAt(field: FieldId, level: number): number {
  return FIELDS[field]?.values?.[level] ?? 0;
}

/**
 * A Field's Value now: a University's at its current Level; an owned Museum's
 * is 400,000 whichever Seat owns it (F2 fixed); 0 for anything unowned.
 */
export function valueOf(state: GameState, field: FieldId): number {
  const fieldState = state.fields[field];
  if (FIELDS[field]?.kind === "museum") return fieldState?.owner ? MUSEUM_VALUE : 0;
  return valueAt(field, fieldState?.level ?? 0);
}

/** What the Bank pays for the Field: 90% of its Value (R30); 360,000 for a Museum. */
export function saleValueOf(state: GameState, field: FieldId): number {
  return Math.round((valueOf(state, field) * SALE_PERCENT) / 100);
}

/** What a Buyout of the Field costs: 200% of its Value (R30, R52). */
export function buyoutPriceOf(state: GameState, field: FieldId): number {
  return (valueOf(state, field) * BUYOUT_PERCENT) / 100;
}

/** True when one Player owns every University of the Group (R29, F1). */
export function isMonopoly(state: GameState, group: GroupId): boolean {
  const owners = FIELDS.filter((f) => f.group === group).map((f) => state.fields[f.id]?.owner);
  const [first] = owners;
  return first != null && owners.every((owner) => owner === first);
}

/** How many Museums `owner` holds. */
function museumsOf(state: GameState, owner: string): number {
  return FIELDS.filter((f) => f.kind === "museum" && state.fields[f.id]?.owner === owner).length;
}

/** What a Player other than the owner pays on landing here now; 0 when unowned. */
export function rentOf(state: GameState, field: FieldId): number {
  const info = FIELDS[field];
  const fieldState = state.fields[field];
  if (!fieldState?.owner) return 0;
  if (info?.kind === "museum") return MUSEUM_RENT_STEP * museumsOf(state, fieldState.owner);
  if (!info?.group) return 0;
  const rent = (valueOf(state, field) * (RENT_PERCENT[fieldState.level] ?? 0)) / 100;
  return Math.round(isMonopoly(state, info.group) ? (rent * MONOPOLY_TENTHS) / 10 : rent);
}
