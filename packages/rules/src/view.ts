import type { FieldId } from "#board.ts";
import { FIELD_COUNT } from "#board.ts";
import { ROUND_BONUS, TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
import { autoSellPicks } from "#rules/charge.ts";
import { baseRentOf, rentOf, saleValueOf, valueOf } from "#rules/pricing.ts";
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
export type PublicView = Omit<GameState, "rng" | "fields"> & {
  fields: FieldView[];
  /**
   * The Turn timer ring: it runs for `limitMs` and empties at `endsAt`, which
   * is the slack before `turnDeadline` (the slack is never shown).
   */
  turnTimer: { endsAt: number; limitMs: number };
  /** During a Sale, the Fields Auto-sell would sell (R68); `null` outside a Sale. */
  autoSell: FieldId[] | null;
  /** During a Doubler or Erasmus pick, each option's effect; `null` outside one. */
  pickOptions: PickOption[] | null;
};

/** The effect of every Field a Doubler or Erasmus pick offers (R59–R61, R64, R65). */
function pickOptions(state: GameState): PickOption[] | null {
  const { phase } = state;
  if (phase.kind === "placingDoubler") {
    return phase.fields.map((field) => {
      // Placed again on the Field that already carries it, the count stacks.
      const countAfter = state.doubler?.field === field ? state.doubler.count + 1 : 1;
      return {
        kind: "doubler",
        field,
        rent: rentOf(state, field),
        rentAfter: baseRentOf(state, field) * (countAfter + 1),
      };
    });
  }
  if (phase.kind === "choosingErasmus") {
    const from = state.players.find((player) => player.id === state.currentPlayer)?.position ?? 0;
    return phase.fields.map((field) => {
      const steps = (field - from + FIELD_COUNT) % FIELD_COUNT;
      const passesStart = from + steps >= FIELD_COUNT;
      return {
        kind: "erasmus",
        field,
        steps,
        passesStart,
        bonus: passesStart ? ROUND_BONUS : null,
      };
    });
  }
  return null;
}

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
    autoSell:
      state.phase.kind === "selling"
        ? autoSellPicks(state, state.currentPlayer, state.phase.shortfall)
        : null,
    pickOptions: pickOptions(state),
  };
}
