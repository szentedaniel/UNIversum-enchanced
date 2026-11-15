/**
 * The board as the UI shows it (ADR-0005): the Players with their Wealth, the
 * Fields with their Value, Rent and Sale, and the Doubler. The public view and
 * every reveal are built from this one derivation, so a half-revealed board
 * and the final view can never disagree on a price.
 *
 * This module imports only the static Board data and the pricing rules: `tx.ts`
 * records a reveal at every `emit`, and the view's rule imports (`autoSellPicks`,
 * `standingsOf`) reach back to `tx.ts`, so a module between them would close an
 * import cycle.
 */
import type { FieldId } from "#board.ts";
import {
  basePriceOf,
  levelRentsOf,
  rentOf,
  saleValueOf,
  valueOf,
  wealthOf,
} from "#rules/pricing.ts";
import type { DoublerState, FieldState, GameState, PlayerState } from "#state.ts";

/** A Player as clients see them: their state plus the numbers the UI shows. */
export type PlayerView = PlayerState & {
  /** Cash plus the Value of their Fields; the podium ranks by it (R77). */
  wealth: number;
};

/** A Field as clients see them: its state plus the numbers the UI shows. */
export type FieldView = FieldState & {
  /** What the Field is worth at its current Level (0 when unbuilt). */
  value: number;
  /** What another Player pays on landing here now (0 when unowned). */
  rent: number;
  /** What the Bank pays for it in a Sale: 90% of Value (360,000 for a Museum). */
  sale: number;
  /**
   * The Rent a University charges at Levels 1–4, `[0]` being Level 1: ×1.4
   * while its current owner holds the Group, the plain Level Rents otherwise
   * and while it is unowned (R28, R29). The Doubler never multiplies it.
   * Empty for every Field that has no Levels (R25).
   */
  levelRents: number[];
  /** What the Bank charges for it while unowned: a University's Level 1 Value, a Museum's 400,000; 0 otherwise (R26, R53). */
  basePrice: number;
  /** How many Doublers stand on the Field; 0 when none (R61, F10). */
  doublers: number;
};

/**
 * What the Board and the Player cards show of a game. It owns every object in
 * it: rule code keeps mutating `tx.state` after `emit`, so a reveal must not
 * share one with the working state.
 */
export type Reveal = {
  players: PlayerView[];
  fields: FieldView[];
  doubler: DoublerState | null;
};

/** Snapshots the Players, the Fields and the Doubler as the UI shows them (ADR-0005). */
export function revealOf(state: GameState): Reveal {
  return {
    players: state.players.map((player) => ({
      ...player,
      name: { ...player.name },
      wealth: wealthOf(state, player.id),
    })),
    fields: state.fields.map((field, id: FieldId) => ({
      owner: field.owner,
      level: field.level,
      value: valueOf(state, id),
      rent: rentOf(state, id),
      sale: saleValueOf(state, id),
      levelRents: levelRentsOf(state, id),
      basePrice: basePriceOf(id),
      doublers: state.doubler?.field === id ? state.doubler.count : 0,
    })),
    doubler: state.doubler && { ...state.doubler },
  };
}
