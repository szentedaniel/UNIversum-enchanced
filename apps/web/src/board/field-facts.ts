/**
 * What the Field card and the Board's tiles show about one Field, read from
 * the pushed view and the static Board data only (the web app holds no rule
 * logic). This is the one place that maps the view to the card and the tiles:
 * Rent and Value come from the view's Field (#26), the Level Rent table, the
 * base price and the Doubler count ride in it since #315, and the Group's
 * Fields come from `FIELDS` Group membership.
 */
import type { PlayerState, PublicView } from "@universum/rules";
import { FIELDS, type FieldId, type FieldInfo } from "@universum/rules/board";

/** One Field of the tapped Field's Group, with its owner from the view. */
export type GroupMember = {
  field: FieldInfo;
  owner: PlayerState | null;
};

export type FieldFacts = {
  field: FieldInfo;
  /** Universities and Museums can be owned; the card shows Rent / Level / Value and the owner. */
  ownable: boolean;
  owner: PlayerState | null;
  level: number;
  /** What landing here costs now, or `null` while nobody owns it. */
  rent: number | null;
  /** The Field's Value at its Level, or `null` while nobody owns it. */
  value: number | null;
  /**
   * What a University charges at Levels 1–4, `[0]` being Level 1: the view's
   * table, with the Monopoly multiplier already applied. Empty for a Field
   * without Levels.
   */
  levelRents: number[];
  /** Every Field of the University's Group in Board order, with its owner; `null` without a Group. */
  group: GroupMember[] | null;
  /** True only when one owner holds every Field of the Group, as `isMonopoly` decides. */
  monopoly: boolean;
  /** What the Bank charges for the Field while nobody owns it; `null` once owned. */
  basePrice: number | null;
  /** How many Doublers stand on the Field; 0 when none (R61, F10). */
  doublers: number;
};

export function fieldFacts(view: PublicView | null, id: FieldId): FieldFacts | null {
  const field = FIELDS[id];
  if (!field) return null;
  const state = view?.fields[id];
  const ownerOf = (playerId: string | null | undefined): PlayerState | null =>
    playerId ? (view?.players.find((p) => p.id === playerId) ?? null) : null;
  const owner = ownerOf(state?.owner);
  const ownable = field.kind === "university" || field.kind === "museum";
  const group =
    field.group === null
      ? null
      : FIELDS.filter((member) => member.group === field.group).map((member) => ({
          field: member,
          owner: ownerOf(view?.fields[member.id]?.owner),
        }));
  const held = group?.[0]?.owner ?? null;
  return {
    field,
    ownable,
    owner,
    level: state?.level ?? 0,
    rent: owner && state ? state.rent : null,
    value: owner && state ? state.value : null,
    levelRents: state?.levelRents ?? [],
    group,
    monopoly:
      held !== null && group !== null && group.every((member) => member.owner?.id === held.id),
    basePrice: ownable && !owner && state ? state.basePrice : null,
    doublers: state?.doublers ?? 0,
  };
}
