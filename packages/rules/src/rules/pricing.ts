/**
 * What a Field is worth and what it charges, from the static Board data and
 * the current state (R26–R31, R53, F2). Pure functions of the state, shared by
 * the rule areas and `publicView`. The Doubler (#31) extends `rentOf`.
 */
import {
  FIELDS,
  MAX_LEVEL,
  MUSEUM_VALUE,
  type FieldId,
  type FieldInfo,
  type GroupId,
} from "#board.ts";
import type { GameState, PlayerId } from "#state.ts";

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
 * What the Bank charges for the Field while it is unowned: a University's
 * Level 1 Value, its base price B (R26); a Museum's 400,000 (R53); 0 for a
 * Field nobody can own.
 */
export function basePriceOf(field: FieldId): number {
  if (FIELDS[field]?.kind === "museum") return MUSEUM_VALUE;
  return valueAt(field, 1);
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

/**
 * How `state` answers who owns a Field. The Group tests read owners through
 * it, and so does the summary fold, which passes its own list instead.
 */
export function fieldOwnerOf(state: GameState): (field: FieldId) => PlayerId | null {
  return (field) => state.fields[field]?.owner ?? null;
}

/**
 * True when `ownerOf` says `owner` holds every University of the Group (R29,
 * F1). `isMonopoly` reads the state's Field owners; the summary fold reads the
 * owners it built from the event list, through the same test.
 */
export function ownsGroup(
  ownerOf: (field: FieldId) => PlayerId | null,
  group: GroupId,
  owner: PlayerId,
): boolean {
  return FIELDS.filter((f) => f.group === group).every((f) => ownerOf(f.id) === owner);
}

/** True when `owner` owns every University of the Group (R29, F1). */
export function isMonopoly(state: GameState, group: GroupId, owner: PlayerId): boolean {
  return ownsGroup(fieldOwnerOf(state), group, owner);
}

/** How many Museums `owner` holds (R53). */
export function museumsOf(state: GameState, owner: PlayerId): number {
  return FIELDS.filter((f) => f.kind === "museum" && state.fields[f.id]?.owner === owner).length;
}

/**
 * The Value of every Field the Player owns: Universities at their current
 * Level, each Museum at 400,000 whoever owns it (F2). Tax charges a share of
 * it; a Player's Wealth is this plus their cash (R77).
 */
export function fieldsValue(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const info of FIELDS) {
    if (state.fields[info.id]?.owner !== playerId) continue;
    total += valueOf(state, info.id);
  }
  return total;
}

/** A Player's Wealth: cash plus the Value of their Fields (R77, the time-up ranking). */
export function wealthOf(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((p) => p.id === playerId);
  return (player?.cash ?? 0) + fieldsValue(state, playerId);
}

/**
 * A University's Rent at `level` before the Monopoly multiplier and the
 * Doublers: its Value there × that Level's rate (R28). 168,000 at Level 2 of a
 * 240,000 University.
 */
function levelBaseRent(value: number, level: number): number {
  return Math.round((value * (RENT_PERCENT[level] ?? 0)) / 100);
}

/**
 * The Rent `base` charges with `count` Doublers on the Field (R61, F10) and,
 * with no Doubler, ×1.4 when a University's owner holds its Group (R29). A
 * Museum keeps its count multiplier and never the Monopoly.
 */
function rentFrom(
  base: number,
  info: FieldInfo | undefined,
  monopoly: boolean,
  count: number,
): number {
  if (info?.kind === "museum" || count > 0) return base * (count + 1);
  if (!info?.group) return 0;
  return monopoly ? Math.round((base * MONOPOLY_TENTHS) / 10) : base;
}

/**
 * The Rent before the Monopoly multiplier and the Doubler count (R61): a
 * University's Value × its Level's rate, or a Museum's 75,000 × the owner's
 * Museums. 0 when unowned.
 */
export function baseRentOf(state: GameState, field: FieldId): number {
  const info = FIELDS[field];
  const fieldState = state.fields[field];
  if (!fieldState?.owner) return 0;
  if (info?.kind === "museum") return MUSEUM_RENT_STEP * museumsOf(state, fieldState.owner);
  if (!info?.group) return 0;
  return levelBaseRent(valueOf(state, field), fieldState.level);
}

/**
 * The Rent a University charges at each Level 1–4 (`levelRents[0]` is Level 1),
 * as the Field card's table shows it: ×1.4 when its current owner holds the
 * Group (R29), the plain Level Rents otherwise and while it is unowned (R28).
 * The Doubler never multiplies the table; `rent` carries it. Empty for
 * anything but a University, which has no Levels (R25).
 */
export function levelRentsOf(state: GameState, field: FieldId): number[] {
  const info = FIELDS[field];
  if (info?.kind !== "university" || !info.group) return [];
  const owner = state.fields[field]?.owner ?? null;
  const monopoly = owner !== null && isMonopoly(state, info.group, owner);
  const rents: number[] = [];
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    rents.push(rentFrom(levelBaseRent(valueAt(field, level), level), info, monopoly, 0));
  }
  return rents;
}

/**
 * What a Player other than the owner pays on landing here now; 0 when unowned.
 * A Doubler multiplies plain Rent by its count + 1, without the Monopoly ×1.4
 * on a University; a Museum keeps its count multiplier (R61, F10).
 */
export function rentOf(state: GameState, field: FieldId): number {
  return rentWithCount(state, field, state.doubler?.field === field ? state.doubler.count : 0);
}

/**
 * The Rent with `count` Doublers on the Field (R61, F10), so a pick can price
 * the placement it offers without restating the rule.
 */
export function rentWithCount(state: GameState, field: FieldId, count: number): number {
  const info = FIELDS[field];
  const fieldState = state.fields[field];
  if (!fieldState?.owner) return 0;
  const monopoly = info?.group ? isMonopoly(state, info.group, fieldState.owner) : false;
  return rentFrom(baseRentOf(state, field), info, monopoly, count);
}
