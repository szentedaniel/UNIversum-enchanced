// The web app's test-only hooks (apps/web/src/test-hooks.ts), as the specs
// see them inside `page.evaluate`. One declaration for every spec.

export type ViewSummary = {
  turn: number;
  version: number;
  currentPlayer: string;
  phase: {
    kind: string;
    field?: number;
    levels?: { level: number; price: number }[];
    /** The Museum's price on a Museum offer. */
    museum?: number;
    /** The Buyout price on a Buyout offer. */
    buyout?: number;
  };
  fields: { owner: string | null; level: number; value: number; rent: number }[];
};
export type Camera = { scale: number; x: number; y: number };
export type PickMarks = { pickable: number[]; picked: number[]; ringed: number[] };
export type FullPickOption =
  | { kind: "doubler"; field: number; rent: number; rentAfter: number }
  | {
      kind: "erasmus";
      field: number;
      steps: number;
      passesStart: boolean;
      bonus: number | null;
    };
/** The parts of a full pushed view (PublicView) that specs change before `showView`. */
export type FullView = {
  currentPlayer: string;
  phase: unknown;
  players: { id: string; bankrupt: boolean }[];
  fields: { owner: string | null; level: number; value: number; rent: number; sale: number }[];
  doubler: { field: number; count: number } | null;
  autoSell: number[] | null;
  pickOptions: FullPickOption[] | null;
  turnDeadline: number;
  turnTimer: { endsAt: number; limitMs: number };
};

declare global {
  interface Window {
    universumTest?: {
      fieldCenter(id: number): { x: number; y: number };
      camera(): Camera;
      view(): ViewSummary | null;
      pick(): PickMarks | null;
      /** Shows a made-up view (a full PublicView) as if the server had pushed it. */
      showView(view: FullView): void;
      /** The room store (only the fields the specs read). */
      room(): {
        me: string | null;
        status: string;
        push: { view: FullView; clockOffset: number } | null;
      };
    };
  }
}
