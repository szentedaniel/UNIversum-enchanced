/**
 * The tray's Field checklist (spec: Client → Pick flow; #39): one row per
 * pickable Field, in the order the Player should choose from, read from the
 * view only. Rows toggle the same picks as the Board; the tray renders them
 * and the Board pans to a row's Field (never zooms).
 */
import type { PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import type { SinglePick } from "#pick/pick.ts";
import type { SalePick } from "#pick/sale.ts";

export type ChecklistRow =
  | { kind: "sale"; field: FieldId; sale: number; auto: boolean }
  | { kind: "doubler"; field: FieldId; rent: number | null; rentAfter: number | null }
  | { kind: "erasmus"; field: FieldId; steps: number; bonus: number | null };

/** The Sale's rows: cheapest sale value first, Auto-sell's picks badged. */
export function saleChecklist(sale: SalePick, view: PublicView): ChecklistRow[] {
  return sale.pickable
    .map((field) => ({
      kind: "sale" as const,
      field,
      sale: view.fields[field]?.sale ?? 0,
      auto: sale.autoSell.includes(field),
    }))
    .toSorted((a, b) => a.sale - b.sale || a.field - b.field);
}

/**
 * The Doubler's rows in Board order with each Field's Rent effect, and
 * Erasmus's destinations nearest first with their distance and Start bonus.
 */
export function singleChecklist(pick: SinglePick): ChecklistRow[] {
  if (pick.kind === "doubler") {
    return pick.pickable.map((field) => {
      const option = pick.options.find((candidate) => candidate.field === field);
      const effect = option?.kind === "doubler" ? option : null;
      return {
        kind: "doubler" as const,
        field,
        rent: effect?.rent ?? null,
        rentAfter: effect?.rentAfter ?? null,
      };
    });
  }
  return pick.pickable
    .map((field) => {
      const option = pick.options.find((candidate) => candidate.field === field);
      const effect = option?.kind === "erasmus" ? option : null;
      return {
        kind: "erasmus" as const,
        field,
        steps: effect?.steps ?? 0,
        bonus: effect?.bonus ?? null,
      };
    })
    .toSorted((a, b) => a.steps - b.steps || a.field - b.field);
}

/**
 * ‹ › stepping during a pick: only `fields` (the pickable ones), wrapping
 * round. From a Field outside the list, start at its first (forward) or last
 * (backward) entry. `null` when there is nowhere to step.
 */
export function stepThrough(fields: readonly FieldId[], id: FieldId, by: number): FieldId | null {
  if (fields.length === 0) return null;
  const index = fields.indexOf(id);
  if (index === -1) return by > 0 ? (fields[0] ?? null) : (fields.at(-1) ?? null);
  return fields[(index + by + fields.length) % fields.length] ?? null;
}
