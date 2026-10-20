/**
 * What the Field card and the Board's tiles show about one Field, read from
 * the pushed view and the static Board data only (the web app holds no rule
 * logic). This is the one place that maps the view to the card and the tiles:
 * Rent and Value come from the view's Field (#26), shown once someone owns it.
 */
import type { PlayerState, PublicView } from "@universum/rules";
import { FIELDS, type FieldId, type FieldInfo } from "@universum/rules/board";

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
};

export function fieldFacts(view: PublicView | null, id: FieldId): FieldFacts | null {
  const field = FIELDS[id];
  if (!field) return null;
  const state = view?.fields[id];
  const owner = state?.owner ? (view?.players.find((p) => p.id === state.owner) ?? null) : null;
  return {
    field,
    ownable: field.kind === "university" || field.kind === "museum",
    owner,
    level: state?.level ?? 0,
    rent: owner && state ? state.rent : null,
    value: owner && state ? state.value : null,
  };
}
