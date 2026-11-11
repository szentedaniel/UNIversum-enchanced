/**
 * Player-to-Player Chance payments (Dorm party, Thesis printing; spec #174).
 * Each payment is a normal Charge whose payee is a Player, so a payer short of
 * cash sells Fields for the Shortfall exactly as on Rent.
 *
 * The card pays in Seat order. A Sale that stops one payment keeps the payer
 * as the current Player, and the Charge carries the rest of the card, so the
 * card finishes once the Sale does; otherwise the drawer is the current
 * Player again when the last payment is made.
 */
import { charge, type ChancePayment, type PendingCharge } from "#rules/charge.ts";
import type { PlayerId } from "#state.ts";
import { playerById, type Tx } from "#tx.ts";

declare module "#events.ts" {
  interface EventMap {
    /** `player` paid `payee` `amount` for a Chance card (Dorm party, Thesis printing). */
    ChanceTransferPaid: { player: PlayerId; payee: PlayerId; amount: number };
  }
}

/**
 * Makes `payments` in Seat order, skipping a Player who is already Bankrupt.
 * Returns true once every payment is made (the drawer is the current Player
 * again); false when a Sale opened and the rest waits on its `resume`.
 */
export function payTransfers(tx: Tx, actor: PlayerId, payments: readonly ChancePayment[]): boolean {
  for (const [index, payment] of payments.entries()) {
    if (playerById(tx, payment.payer).bankrupt) continue;
    tx.state.currentPlayer = payment.payer;
    charge(tx, payment.payer, {
      kind: "chanceTransfer",
      amount: payment.amount,
      payee: payment.payee,
      actor,
      rest: payments.slice(index + 1),
    });
    if (tx.decided) return false;
  }
  tx.state.currentPlayer = actor;
  return true;
}

/** Carries on with the payments a Sale interrupted, from the Sale's Charge. */
export function resumeTransfers(
  tx: Tx,
  pending: Extract<PendingCharge, { kind: "chanceTransfer" }>,
): boolean {
  return payTransfers(tx, pending.actor, pending.rest);
}
