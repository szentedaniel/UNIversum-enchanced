import type { FieldId } from "#board.ts";
import { TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
import { rentOf, saleValueOf, valueOf } from "#rules/pricing.ts";
import type { FieldState, GameState } from "#state.ts";

/** A Field as clients see it: its state plus the numbers the UI shows. */
export type FieldView = FieldState & {
  /** What the Field is worth at its current Level (0 when unbuilt). */
  value: number;
  /** What another Player pays on landing here now (0 when unowned). */
  rent: number;
  /** What the Bank pays for it in a Sale: 90% of Value (360,000 for a Museum). */
  sale: number;
};

/**
 * The one view every client in the Room sees. It never contains the PRNG
 * state. Fields are listed one by one on purpose: a new state field fails to
 * compile here until someone decides whether clients may see it. Derived
 * numbers the UI shows (Rent, Buyout price, Auto-sell's picks) are added here.
 */
export type PublicView = Omit<GameState, "rng" | "fields"> & {
  fields: FieldView[];
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
    fields: state.fields.map((field, id: FieldId) => ({
      owner: field.owner,
      level: field.level,
      value: valueOf(state, id),
      rent: rentOf(state, id),
      sale: saleValueOf(state, id),
    })),
    doubler: state.doubler,
    lastChanceCard: state.lastChanceCard,
  };
}
