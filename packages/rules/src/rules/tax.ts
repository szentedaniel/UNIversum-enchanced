/**
 * Tax (R36–R38, F2): landing on the Tax Field charges 10% of the Value of the
 * Player's Fields to the Bank. It applies at once, with no confirmation (R37).
 */
import { charge } from "#rules/charge.ts";
import type { Landing } from "#rules/landing.ts";
import { fieldsValue } from "#rules/pricing.ts";
import type { PlayerId } from "#state.ts";

declare module "#events.ts" {
  interface EventMap {
    /** `player` paid `amount` Tax to the Bank (0 when they own no Fields). */
    TaxPaid: { player: PlayerId; amount: number };
  }
}

/** Tax is this percentage of the Value of the Player's Fields (R36). */
const TAX_PERCENT = 10;

/** Landing on Tax: the amount is computed once, here (R36, spec story 78). */
export const landOnTax: Landing = (tx, playerId) => {
  const amount = Math.round((fieldsValue(tx.state, playerId) * TAX_PERCENT) / 100);
  // A Sale for it pays this same amount afterwards: Tax is not recomputed (F20).
  charge(tx, playerId, { kind: "tax", amount });
};
