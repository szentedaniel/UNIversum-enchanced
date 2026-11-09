import type { FieldId } from "#board.ts";
import { TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
import { autoSellPicks } from "#rules/charge.ts";
import { doublerPlacement } from "#rules/doubler.ts";
import { erasmusRoute } from "#rules/erasmus.ts";
import { standingsOf, type Standing } from "#rules/game-end.ts";
import { revealOf, type FieldView, type PlayerView } from "#reveal.ts";
import type { GameState } from "#state.ts";

/**
 * The Turn timer the ring shows: it runs for `limitMs` and empties at
 * `endsAt`, which is the slack before `turnDeadline` (the slack is never
 * shown). `endsAt - limitMs` is the state's `actsAfter`: the ring stays full
 * until the Playback ends, then empties over the Turn limit (ADR-0004).
 */
export type TurnTimer = { endsAt: number; limitMs: number };

/** The server's clock overrides for the view (e2e runs); production leaves both out. */
export type ViewTiming = { turnLimitMs?: number };

/**
 * The effect of one offered Field in a Doubler or Erasmus pick: the numbers
 * the tray shows next to the choice, so the client holds no rules.
 */
export type PickOption =
  /** Doubler: the Rent now and after the token is placed here (R61). */
  | { kind: "doubler"; field: FieldId; rent: number; rentAfter: number }
  /**
   * Erasmus: the Fields ahead, whether the route passes Start, and the Round
   * bonus it pays then (R65); `bonus` is `null` when Start is not passed.
   */
  | { kind: "erasmus"; field: FieldId; steps: number; passesStart: boolean; bonus: number | null };

/**
 * The one view every client in the Room sees. It never contains the PRNG
 * state. Fields are listed one by one on purpose: a new state field fails to
 * compile here until someone decides whether clients may see it. Derived
 * numbers the UI shows (Rent, Buyout price, Auto-sell's picks) are added here.
 */
export type PublicView = Omit<GameState, "rng" | "fields" | "players"> & {
  fields: FieldView[];
  players: PlayerView[];
  /** The Turn timer ring; `null` once the game is over. */
  turnTimer: TurnTimer | null;
  /** During a Sale, the Fields Auto-sell would sell (R68); `null` outside a Sale. */
  autoSell: FieldId[] | null;
  /** During a Doubler or Erasmus pick, each option's effect; `null` outside one. */
  pickOptions: PickOption[] | null;
  /** The final standings in podium order; `null` until the game is over (R80). */
  standings: Standing[] | null;
};

/** The effect of every Field a Doubler or Erasmus pick offers (R59–R61, R64, R65). */
function pickOptions(state: GameState): PickOption[] | null {
  const { phase } = state;
  if (phase.kind === "placingDoubler") {
    return phase.fields.map((field) => {
      const { rent, rentAfter } = doublerPlacement(state, field);
      return { kind: "doubler", field, rent, rentAfter };
    });
  }
  if (phase.kind === "choosingErasmus") {
    return phase.fields.map((field) => {
      const { steps, passesStart, bonus } = erasmusRoute(state, field);
      return { kind: "erasmus", field, steps, passesStart, bonus };
    });
  }
  return null;
}

export function publicView(state: GameState, timing: ViewTiming = {}): PublicView {
  return {
    ...revealOf(state),
    stateVersion: state.stateVersion,
    version: state.version,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    actsAfter: state.actsAfter,
    turnDeadline: state.turnDeadline,
    turnTimer:
      state.turnDeadline === null
        ? null
        : {
            endsAt: state.turnDeadline - TURN_SLACK_MS,
            limitMs: timing.turnLimitMs ?? TURN_LIMIT_MS,
          },
    settings: state.settings,
    endsAt: state.endsAt,
    lastChanceCard: state.lastChanceCard,
    autoSell:
      state.phase.kind === "selling"
        ? autoSellPicks(state, state.currentPlayer, state.phase.shortfall)
        : null,
    pickOptions: pickOptions(state),
    standings: standingsOf(state),
  };
}
