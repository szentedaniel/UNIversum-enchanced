/**
 * The Sale (R66–R69, F9): the current Player sells Fields to the Bank to cover
 * a Shortfall, by picking them or with Auto-sell. The Charge that opened the
 * Sale (`resume`) is then paid in full from cash, and the landing goes on as
 * if it had been paid in cash at once.
 */
import { FIELDS, type FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import {
  autoSellPicks,
  payFromCash,
  saleValueOfAll,
  sellFields,
  type PendingCharge,
} from "#rules/charge.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { offerBuyout } from "#rules/universities.ts";
import type { PhaseOf, PlayerId } from "#state.ts";
import type { Tx } from "#tx.ts";

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Sell these of the Player's Fields; their sale value must cover the Shortfall (R66, R67). */
    SellFields: { fields: FieldId[] };
    /** Sell cheapest first until the Shortfall is covered (R68). */
    AutoSell: {};
  }
}

function saleOf(tx: Tx): PhaseOf<"selling"> {
  const { phase } = tx.state;
  if (phase.kind !== "selling") throw new Error(`no Sale in phase ${phase.kind}`);
  return phase;
}

/** After the Sale: the Charge is paid, then whatever followed it at landing. */
function resume(tx: Tx, playerId: PlayerId, pending: PendingCharge): void {
  payFromCash(tx, playerId, pending);
  if (pending.kind === "rent" && FIELDS[pending.field]?.kind === "university") {
    offerBuyout(tx, playerId, pending.field);
  }
  if (!tx.decided) passTurn(tx);
}

/**
 * Auto-sell for the open Sale, then the Charge is paid (R68, F9). The timeout
 * (R69) runs this before the Timeout penalty, without passing the Turn.
 */
export function autoSellAndPay(tx: Tx): void {
  const { shortfall, resume: pending } = saleOf(tx);
  const playerId = tx.state.currentPlayer;
  sellFields(tx, playerId, autoSellPicks(tx.state, playerId, shortfall), true);
  payFromCash(tx, playerId, pending);
}

export const saleIntents = {
  SellFields: {
    actor: "player",
    phases: ["selling"],
    run(tx, intent) {
      const { shortfall, resume: pending } = saleOf(tx);
      const playerId = tx.state.currentPlayer;
      const { fields } = intent;
      const own = fields.every((field) => tx.state.fields[field]?.owner === playerId);
      if (!own || new Set(fields).size !== fields.length) return rejection("NOT_OFFERED");
      if (saleValueOfAll(tx.state, fields) < shortfall) return rejection("SHORTFALL_NOT_COVERED");
      sellFields(tx, playerId, fields, false);
      resume(tx, playerId, pending);
      return undefined;
    },
  },
  AutoSell: {
    actor: "player",
    phases: ["selling"],
    run(tx) {
      const { shortfall, resume: pending } = saleOf(tx);
      const playerId = tx.state.currentPlayer;
      sellFields(tx, playerId, autoSellPicks(tx.state, playerId, shortfall), true);
      resume(tx, playerId, pending);
    },
  },
} satisfies Partial<IntentHandlers>;
