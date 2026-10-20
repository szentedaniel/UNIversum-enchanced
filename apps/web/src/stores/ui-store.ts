/**
 * Local UI state that never goes to the server: the open Field card, the
 * camera mode and the Fields picked in a Sale. The Board subscribes outside
 * React. Panels and the checklist preference join it later (#39).
 */
import type { FieldId } from "@universum/rules/board";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { toggledPicks } from "#pick/sale.ts";

export type UiState = {
  /** The Field whose card is open (a tap on the Board, or ‹ › on the card). */
  selectedField: FieldId | null;
  selectField(field: FieldId | null): void;
  /** Camera mode: Follow keeps the moving pawn in view (opt-in; a drag turns it off). */
  follow: boolean;
  setFollow(follow: boolean): void;
  /** The Fields picked in the Sale whose decision is `key` (`pickKey`); stale for any other. */
  salePicks: { key: string; fields: FieldId[] };
  /** A tap in a Sale: picks the Field, or unpicks it. Never commits. */
  toggleSalePick(key: string, field: FieldId): void;
  /** The Field chosen in a Doubler or Erasmus pick whose decision is `key`; one at most. */
  singlePick: { key: string; field: FieldId | null };
  /** A tap in a single pick: selects the Field, replacing the earlier choice. Never commits. */
  choosePick(key: string, field: FieldId | null): void;
};

export const uiStore = createStore<UiState>()(
  subscribeWithSelector((set) => ({
    selectedField: null,
    selectField: (field) => set({ selectedField: field }),
    follow: false,
    setFollow: (follow) => set({ follow }),
    salePicks: { key: "", fields: [] },
    toggleSalePick: (key, field) =>
      set(({ salePicks }) => ({
        salePicks: {
          key,
          fields: toggledPicks(salePicks.key === key ? salePicks.fields : [], field),
        },
      })),
    singlePick: { key: "", field: null },
    choosePick: (key, field) => set({ singlePick: { key, field } }),
  })),
);

const NO_PICKS: readonly FieldId[] = [];

/** The picks of the Sale whose decision is `key` (a stable empty list for any other). */
export const salePicksFor = (picks: UiState["salePicks"], key: string): readonly FieldId[] =>
  picks.key === key ? picks.fields : NO_PICKS;
