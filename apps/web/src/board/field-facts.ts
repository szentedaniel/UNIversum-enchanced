/**
 * What the Field card and the Board's tiles show about one Field, read from
 * the pushed view and the static Board data only (the web app holds no rule
 * logic). This is the one place that maps the view to the card: when the view
 * gains a Field's numbers (Rent and Value arrive with the Universities, #26),
 * read them here and both the card and the tiles follow.
 */
import type { PlayerState, PublicView } from "@universum/rules";
import { FIELDS, type FieldId, type FieldInfo } from "@universum/rules/board";

export type FieldFacts = {
  field: FieldInfo;
  /** Universities and Museums can be owned; the card shows Rent / Level / Value and the owner. */
  ownable: boolean;
  owner: PlayerState | null;
  level: number;
  /** What landing here costs now, or `null` while the view doesn't say. */
  rent: number | null;
  /** The Field's Value, or `null` while the view doesn't say. */
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
    rent: null,
    value: null,
  };
}
