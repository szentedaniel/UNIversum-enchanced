/**
 * The single-pick tray (spec: Client → Pick flow; #31): the Doubler and
 * Erasmus. Read from the view only: the phase lists the pickable Fields and
 * the view carries each option's effect (Rent now → after; Fields ahead and
 * whether Start is passed), so the client holds no rules. A tap selects one
 * Field, replacing any earlier choice; it never commits.
 */
import type { PickOption, PlayerId, PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { pickKey, type PickMarks } from "#pick/sale.ts";

export type SinglePick = {
  kind: "doubler" | "erasmus";
  /** Picks belong to one decision: this changes with every new one. */
  key: string;
  /** Fields a tap may pick; every other Field is greyed. */
  pickable: FieldId[];
  /** Each pickable Field's effect, from the view. */
  options: PickOption[];
};

/** This client's open Doubler or Erasmus pick, or `null` (another Player's, or none). */
export function singlePickFor(view: PublicView, me: PlayerId | null): SinglePick | null {
  if (view.currentPlayer !== me) return null;
  const { phase } = view;
  if (phase.kind !== "placingDoubler" && phase.kind !== "choosingErasmus") return null;
  const kind = phase.kind === "placingDoubler" ? "doubler" : "erasmus";
  return {
    kind,
    key: pickKey(view),
    pickable: phase.fields,
    options: (view.pickOptions ?? []).filter((option) => option.kind === kind),
  };
}

/** The Field chosen for this decision, or `null` (nothing yet, or a choice from an earlier one). */
export function selectedPick(
  pick: SinglePick,
  selection: { key: string; field: FieldId | null },
): FieldId | null {
  return selection.key === pick.key ? selection.field : null;
}

/** The Board's marks for a single pick: one lifted Field at most. */
export function singleMarks(pick: SinglePick, field: FieldId | null): PickMarks {
  return { pickable: pick.pickable, picked: field === null ? [] : [field], ringed: [] };
}
