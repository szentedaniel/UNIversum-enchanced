import type { FieldId } from "#board.ts";
import { TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
import { autoSellPicks } from "#rules/charge.ts";
import { rentOf, saleValueOf, valueOf, wealthOf } from "#rules/pricing.ts";
import type { FieldState, GameState, PlayerState } from "#state.ts";

/** A Player as clients see them: their state plus the numbers the UI shows. */
export type PlayerView = PlayerState & {
  /** Cash plus the Value of their Fields; the podium ranks by it (R77). */
  wealth: number;
};

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
export type PublicView = Omit<GameState, "rng" | "fields" | "players"> & {
  fields: FieldView[];
  players: PlayerView[];
  /**
   * The Turn timer ring: it runs for `limitMs` and empties at `endsAt`, which
   * is the slack before `turnDeadline` (the slack is never shown). `null`
   * once the game is over.
   */
  turnTimer: { endsAt: number; limitMs: number } | null;
  /** During a Sale, the Fields Auto-sell would sell (R68); `null` outside a Sale. */
  autoSell: FieldId[] | null;
};

export function publicView(state: GameState): PublicView {
  return {
    stateVersion: state.stateVersion,
    version: state.version,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    turnDeadline: state.turnDeadline,
    turnTimer:
      state.turnDeadline === null
        ? null
        : { endsAt: state.turnDeadline - TURN_SLACK_MS, limitMs: TURN_LIMIT_MS },
    settings: state.settings,
    endsAt: state.endsAt,
    players: state.players.map((player) => ({
      ...player,
      wealth: wealthOf(state, player.id),
    })),
    fields: state.fields.map((field, id: FieldId) => ({
      owner: field.owner,
      level: field.level,
      value: valueOf(state, id),
      rent: rentOf(state, id),
      sale: saleValueOf(state, id),
    })),
    doubler: state.doubler,
    lastChanceCard: state.lastChanceCard,
    autoSell:
      state.phase.kind === "selling"
        ? autoSellPicks(state, state.currentPlayer, state.phase.shortfall)
        : null,
  };
}
