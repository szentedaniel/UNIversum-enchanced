/**
 * Charges: amounts a Player owes at once (Rent here; Tax, Chance cards and the
 * Timeout penalty later). Every Charge goes through `charge`, so the one
 * solvency rule (spec: Rules, F6/F7/F8/F20/R38) lands in this one place with
 * the Sale ticket (#29).
 */
import type { PlayerId } from "#state.ts";
import { playerById, type Tx } from "#tx.ts";

/**
 * Takes `amount` from the Player's cash and hands it to `pay` (which credits
 * the payee and emits the event).
 *
 * Until the Sale (#29): when cash doesn't cover the Charge, the Player pays
 * all their cash, so money never goes negative and none is created. #29
 * replaces that branch with the solvency rule (Sale or Bankrupt).
 */
export function charge(
  tx: Tx,
  payer: PlayerId,
  amount: number,
  pay: (amount: number) => void,
): void {
  const player = playerById(tx, payer);
  const paid = Math.min(amount, player.cash);
  player.cash -= paid;
  pay(paid);
}
