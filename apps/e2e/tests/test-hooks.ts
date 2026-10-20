// The web app's test-only hooks (apps/web/src/test-hooks.ts), as the specs
// see them inside `page.evaluate`. One declaration for every spec.

export type ViewSummary = {
  turn: number;
  version: number;
  currentPlayer: string;
  phase: { kind: string; field?: number; levels?: { level: number; price: number }[] };
  fields: { owner: string | null; level: number; value: number; rent: number }[];
};
export type Camera = { scale: number; x: number; y: number };

declare global {
  interface Window {
    universumTest?: {
      fieldCenter(id: number): { x: number; y: number };
      camera(): Camera;
      view(): ViewSummary | null;
    };
  }
}
