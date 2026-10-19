import type { GameState } from "#state.ts";

/**
 * The one view every client in the Room sees. It never contains the PRNG
 * state. Fields are listed one by one on purpose: a new state field fails to
 * compile here until someone decides whether clients may see it. Derived
 * numbers the UI shows (Rent, Buyout price, Auto-sell's picks) are added here.
 */
export type PublicView = Omit<GameState, "rng">;

export function publicView(state: GameState): PublicView {
  return {
    stateVersion: state.stateVersion,
    version: state.version,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    settings: state.settings,
    endsAt: state.endsAt,
    players: state.players,
    fields: state.fields,
    doubler: state.doubler,
  };
}
