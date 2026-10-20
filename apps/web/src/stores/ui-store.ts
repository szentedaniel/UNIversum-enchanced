/**
 * Local UI state that never goes to the server: the open Field card and the
 * camera mode. The Board subscribes outside React. Panels and the checklist
 * preference join it later (#39).
 */
import type { FieldId } from "@universum/rules/board";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export type UiState = {
  /** The Field whose card is open (a tap on the Board, or ‹ › on the card). */
  selectedField: FieldId | null;
  selectField(field: FieldId | null): void;
  /** Camera mode: Follow keeps the moving pawn in view (opt-in; a drag turns it off). */
  follow: boolean;
  setFollow(follow: boolean): void;
};

export const uiStore = createStore<UiState>()(
  subscribeWithSelector((set) => ({
    selectedField: null,
    selectField: (field) => set({ selectedField: field }),
    follow: false,
    setFollow: (follow) => set({ follow }),
  })),
);
