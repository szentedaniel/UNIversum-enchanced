/**
 * Charges and the one solvency rule (spec: Rules; R34, R37, R38, R57, R62,
 * R66–R72, F6–F9, F12, F20). Every amount a Player owes at once (Rent, Tax,
 * a Chance card, the Timeout penalty) goes through here.
 *
 * The Charge is computed once, when it arises, and kept as plain data (a
 * `PendingCharge`) so a Sale can pay it later without recomputing it. Cash
 * that covers it pays it. Otherwise, if cash plus the Bank sale value of all
 * the Player's Fields covers it, the Player goes into a Sale for the
 * Shortfall. Otherwise the Player is Bankrupt at once. Money never goes
 * negative, and no money is created.
 */
import { FIELDS, type FieldId } from "#board.ts";
import { saleValueOf } from "#rules/pricing.ts";
import type { GameState, PlayerId } from "#state.ts";
import { decide, emit, playerById, type Tx } from "#tx.ts";

/**
 * A Charge waiting to be paid: who gets the money and how much. Plain JSON,
 * because it waits in the `selling` phase. Rent goes to the owner; the rest
 * to the Bank.
 */
export type PendingCharge =
  | { kind: "rent"; amount: number; owner: PlayerId; field: FieldId }
  | { kind: "tax"; amount: number }
  | { kind: "chanceCard"; amount: number }
  | { kind: "timeoutPenalty"; amount: number };

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * The current Player must sell Fields to the Bank worth at least
     * `shortfall` (R66), by hand or with Auto-sell; `resume` is the Charge
     * that is paid once they have (R67).
     */
    selling: { shortfall: number; resume: PendingCharge };
  }
}

declare module "#events.ts" {
  interface EventMap {
    /**
     * `player` sold `fields` to the Bank for `amount` (the full sale value,
     * R67); `auto` when Auto-sell picked them (R68, a timeout, the penalty).
     */
    FieldsSold: { player: PlayerId; fields: FieldId[]; amount: number; auto: boolean };
    /** `player` could not cover a Charge: out of the game, `fields` back at the Bank (R70, R71). */
    WentBankrupt: { player: PlayerId; fields: FieldId[] };
  }
}

/** The Fields the Player owns, in Field order. */
export function fieldsOf(state: GameState, playerId: PlayerId): FieldId[] {
  return FIELDS.filter((f) => state.fields[f.id]?.owner === playerId).map((f) => f.id);
}

/** What the Bank pays for all of `fields`. */
export function saleValueOfAll(state: GameState, fields: readonly FieldId[]): number {
  return fields.reduce((sum, field) => sum + saleValueOf(state, field), 0);
}

/**
 * Auto-sell's picks (R68, F9): the Player's Fields cheapest first (by sale
 * value, then Field order), stopping as soon as the proceeds reach `target`.
 * All of them when even that falls short.
 */
export function autoSellPicks(state: GameState, playerId: PlayerId, target: number): FieldId[] {
  const cheapestFirst = fieldsOf(state, playerId).toSorted(
    (a, b) => saleValueOf(state, a) - saleValueOf(state, b) || a - b,
  );
  const picks: FieldId[] = [];
  let proceeds = 0;
  for (const field of cheapestFirst) {
    if (proceeds >= target) break;
    picks.push(field);
    proceeds += saleValueOf(state, field);
  }
  return picks;
}

/** Hands a paid Charge to its payee and tells everyone. */
function payTo(tx: Tx, payer: PlayerId, pending: PendingCharge, amount: number): void {
  switch (pending.kind) {
    case "rent":
      playerById(tx, pending.owner).cash += amount;
      emit(tx, {
        type: "RentPaid",
        player: payer,
        owner: pending.owner,
        field: pending.field,
        amount,
      });
      return;
    case "tax":
      emit(tx, { type: "TaxPaid", player: payer, amount });
      return;
    case "chanceCard":
      emit(tx, { type: "ChanceChargePaid", player: payer, amount });
      return;
    case "timeoutPenalty":
      emit(tx, { type: "TimeoutPenaltyPaid", player: payer, amount });
      return;
  }
}

/** Returns `fields` to the Bank: unowned, Level 0, and without the Doubler (R62, R71). */
function returnToBank(tx: Tx, fields: readonly FieldId[]): void {
  for (const field of fields) tx.state.fields[field] = { owner: null, level: 0 };
  const { doubler } = tx.state;
  if (doubler && fields.includes(doubler.field)) tx.state.doubler = null;
}

/** Sells `fields` to the Bank; the Player keeps the full sale value (R67). */
export function sellFields(tx: Tx, playerId: PlayerId, fields: FieldId[], auto: boolean): void {
  if (fields.length === 0) return;
  const amount = saleValueOfAll(tx.state, fields);
  returnToBank(tx, fields);
  playerById(tx, playerId).cash += amount;
  emit(tx, { type: "FieldsSold", player: playerId, fields, amount, auto });
}

/** Takes the Charge from cash, which must cover it, and pays the payee. */
export function payFromCash(tx: Tx, payer: PlayerId, pending: PendingCharge): void {
  const player = playerById(tx, payer);
  if (player.cash < pending.amount) throw new Error("cash does not cover the Charge");
  player.cash -= pending.amount;
  payTo(tx, payer, pending, pending.amount);
}

/**
 * The Player is Bankrupt (R70–R72): everything they could raise (cash plus
 * the sale value of every Field) goes to the payee, so on Rent the owner gets
 * that and no more (F12); the Fields return to the Bank and the Player ends
 * at 0, skipped in turn order from now on (R14).
 *
 * Two beats (ADR-0005): the Charge is paid first, with the Fields still
 * owned, then they return to the Bank with `WentBankrupt`. The amounts are
 * what the Player could raise, computed before anything moves.
 */
export function goBankrupt(tx: Tx, payer: PlayerId, pending: PendingCharge): void {
  const player = playerById(tx, payer);
  const fields = fieldsOf(tx.state, payer);
  const raised = player.cash + saleValueOfAll(tx.state, fields);
  player.cash = 0;
  payTo(tx, payer, pending, raised);
  returnToBank(tx, fields);
  player.bankrupt = true;
  emit(tx, { type: "WentBankrupt", player: payer, fields });
}

/**
 * The one solvency rule. Pays `pending` from cash, or opens a Sale for the
 * Shortfall (`tx.decided` is then set: the caller stops there), or makes the
 * Player Bankrupt.
 */
export function charge(tx: Tx, payer: PlayerId, pending: PendingCharge): void {
  const { cash } = playerById(tx, payer);
  if (cash >= pending.amount) return payFromCash(tx, payer, pending);
  const sale = saleValueOfAll(tx.state, fieldsOf(tx.state, payer));
  if (cash + sale >= pending.amount) {
    return decide(tx, { kind: "selling", shortfall: pending.amount - cash, resume: pending });
  }
  goBankrupt(tx, payer, pending);
}
