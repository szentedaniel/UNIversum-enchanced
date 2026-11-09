/**
 * The Sale pick (spec: Client → Pick flow; #29): what the tray and the Board
 * show while the Player sells Fields to cover a Shortfall. Read from the view
 * only; the client holds no rule logic (the phase carries the Shortfall and the
 * Charge, the view the sale values and Auto-sell's picks).
 */
import type { PendingCharge, PlayerId, PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";

/** Auto-sell's Fields are ringed this long before the Turn timer runs out (spec story 84). */
export const AUTO_SELL_WARNING_MS = 5_000;

export type SalePick = {
  /** Picks belong to one Sale: this changes with every new decision. */
  key: string;
  shortfall: number;
  /** The Charge the Sale pays. */
  charge: PendingCharge;
  cash: number;
  /** The Player's Fields, cheapest first. */
  pickable: FieldId[];
  /** What Auto-sell would sell. */
  autoSell: FieldId[];
};

/** What the Board marks during the pick. */
export type PickMarks = {
  /** Fields a tap may pick; every other Field is greyed. */
  pickable: FieldId[];
  /** Lifted and green. */
  picked: FieldId[];
  /** Ringed in orange: Auto-sell's Fields in the last seconds of an uncovered Sale. */
  ringed: FieldId[];
};

/** The decision a pick belongs to. */
export const pickKey = (view: PublicView): string => `${view.turn}:${view.turnDeadline}`;

/** This client's open Sale, or `null` (another Player's Sale, or none). */
export function saleFor(view: PublicView, me: PlayerId | null): SalePick | null {
  const { phase } = view;
  if (phase.kind !== "selling" || view.currentPlayer !== me) return null;
  const cash = view.players.find((p) => p.id === me)?.cash ?? 0;
  const pickable = view.fields
    .map((field, id) => ({ id, field }))
    .filter(({ field }) => field.owner === me)
    .toSorted((a, b) => a.field.sale - b.field.sale || a.id - b.id)
    .map(({ id }) => id);
  return {
    key: pickKey(view),
    shortfall: phase.shortfall,
    charge: phase.resume,
    cash,
    pickable,
    autoSell: view.autoSell ?? [],
  };
}

/** A tap toggles a Field: picked again, it leaves the picks. */
export function toggledPicks(picks: readonly FieldId[], id: FieldId): FieldId[] {
  return picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
}

/** The Fields picked in a Sale, keyed by the Decision (`pickKey`) they belong to. */
export type SalePicks = { key: string; fields: FieldId[] };

const NO_PICKS: readonly FieldId[] = [];

/** The picks of the Sale whose decision is `key` (a stable empty list for any other). */
export const salePicksFor = (picks: SalePicks, key: string): readonly FieldId[] =>
  picks.key === key ? picks.fields : NO_PICKS;

/** What the Bank pays for the picked Fields. */
export function salePickedValue(view: PublicView, picks: readonly FieldId[]): number {
  return picks.reduce((sum, id) => sum + (view.fields[id]?.sale ?? 0), 0);
}

/** The Board's marks for the Sale, `msLeft` before the Turn timer runs out. */
export function saleMarks(
  sale: SalePick,
  view: PublicView,
  picks: readonly FieldId[],
  msLeft: number,
): PickMarks {
  const picked = picks.filter((id) => sale.pickable.includes(id));
  const covered = salePickedValue(view, picked) >= sale.shortfall;
  const warn = !covered && msLeft <= AUTO_SELL_WARNING_MS;
  return { pickable: sale.pickable, picked, ringed: warn ? sale.autoSell : [] };
}
