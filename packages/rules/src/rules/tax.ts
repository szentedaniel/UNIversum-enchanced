/**
 * Tax (R36–R38, F2): landing on the Tax Field charges 10% of the Value of the
 * Player's Fields to the Bank. It applies at once, with no confirmation (R37).
 */
import { FIELDS, MUSEUM_VALUE } from "#board.ts";
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { valueOf } from "#rules/pricing.ts";
import type { GameState, PlayerId } from "#state.ts";

declare module "#events.ts" {
  interface EventMap {
    /** `player` paid `amount` Tax to the Bank (0 when they own no Fields). */
    TaxPaid: { player: PlayerId; amount: number };
  }
}

/** Tax is this percentage of the Value of the Player's Fields (R36). */
const TAX_PERCENT = 10;

/**
 * The Value of every Field the Player owns: Universities at their current
 * Level, each Museum at 400,000 whoever owns it (F2). The time-up Wealth (#32)
 * counts Fields the same way.
 */
export function fieldsValue(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const info of FIELDS) {
    if (state.fields[info.id]?.owner !== playerId) continue;
    total += info.kind === "museum" ? MUSEUM_VALUE : valueOf(state, info.id);
  }
  return total;
}

/** Landing on Tax: the amount is computed once, here (R36, spec story 78). */
export const landOnTax: Landing = (tx, playerId) => {
  const amount = Math.round((fieldsValue(tx.state, playerId) * TAX_PERCENT) / 100);
  // A Sale for it pays this same amount afterwards: Tax is not recomputed (F20).
  charge(tx, playerId, { kind: "tax", amount });
};
