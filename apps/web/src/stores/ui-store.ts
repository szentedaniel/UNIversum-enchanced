/**
 * Local UI state that never goes to the server: the Field the Player tapped.
 * The camera mode, panels and checklist preference join it later (#38, #39).
 */
import type { FieldId } from "@universum/rules/board";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export type UiState = {
  /** The Field whose details are shown, from a tap on the Board. */
  selectedField: FieldId | null;
  selectField(field: FieldId | null): void;
};

export const uiStore = createStore<UiState>()(
  subscribeWithSelector((set) => ({
    selectedField: null,
    selectField: (field) => set({ selectedField: field }),
  })),
);
