import { TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
import type { GameState } from "#state.ts";

/**
 * The one view every client in the Room sees. It never contains the PRNG
 * state. Fields are listed one by one on purpose: a new state field fails to
 * compile here until someone decides whether clients may see it. Derived
 * numbers the UI shows (Rent, Buyout price, Auto-sell's picks) are added here.
 */
export type PublicView = Omit<GameState, "rng"> & {
  /**
   * The Turn timer ring: it runs for `limitMs` and empties at `endsAt`, which
   * is the slack before `turnDeadline` (the slack is never shown).
   */
  turnTimer: { endsAt: number; limitMs: number };
};

export function publicView(state: GameState): PublicView {
  return {
    stateVersion: state.stateVersion,
    version: state.version,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    turnDeadline: state.turnDeadline,
    turnTimer: { endsAt: state.turnDeadline - TURN_SLACK_MS, limitMs: TURN_LIMIT_MS },
    settings: state.settings,
    endsAt: state.endsAt,
    players: state.players,
    fields: state.fields,
    doubler: state.doubler,
  };
}
