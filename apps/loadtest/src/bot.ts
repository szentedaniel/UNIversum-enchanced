/**
 * What a scripted Guest does when the view offers it a choice (spec: Load
 * test). It reads only the phase's listed options, so a new decision phase
 * from the rules engine needs no new rules knowledge here: an unknown phase
 * is left to the Turn timer, exactly like a Player who walked away.
 */
import type { ClientIntent, GameMessage } from "@universum/protocol/messages";

type View = GameMessage["view"];

/** Phases that mean the game is over. #32 names its own; match the likely ids. */
const FINISHED_PHASES = new Set(["gameOver", "ended"]);

export function isGameOver(view: View): boolean {
  return FINISHED_PHASES.has(view.phase.kind);
}

export function isMyTurn(view: View, me: string): boolean {
  return view.currentPlayer === me && !isGameOver(view);
}

/** Every intent this view offers the Player, including the "do nothing" ones. */
export function offeredIntents(view: View, me: string): ClientIntent[] {
  if (!isMyTurn(view, me)) return [];
  const turn = view.turn;
  switch (view.phase.kind) {
    case "awaitingRoll":
      return [{ type: "Roll", turn }];
    case "quarantineChoice": {
      const intents: ClientIntent[] = [{ type: "RollForTwelve", turn }];
      if (view.phase.canBuyPcrTest) intents.push({ type: "BuyPcrTest", turn });
      if (view.phase.canUsePcrTest) intents.push({ type: "UsePcrTest", turn });
      return intents;
    }
    case "offer": {
      const intents: ClientIntent[] = view.phase.levels.map((offer) => ({
        type: "BuyLevel",
        turn,
        level: offer.level,
      }));
      if (view.phase.buyout !== undefined) intents.push({ type: "Buyout", turn });
      if (view.phase.museum !== undefined) intents.push({ type: "BuyMuseum", turn });
      intents.push({ type: "DeclineOffer", turn });
      return intents;
    }
    case "selling": {
      const intents: ClientIntent[] = [{ type: "AutoSell", turn }];
      const picks = view.autoSell;
      if (picks !== null && picks.length > 0) {
        intents.push({ type: "SellFields", turn, fields: [...picks] });
      }
      return intents;
    }
    default:
      return [];
  }
}

/** One uniformly random offered intent, or `null` when this Player has no decision. */
export function chooseIntent(view: View, me: string, random: () => number): ClientIntent | null {
  const intents = offeredIntents(view, me);
  if (intents.length === 0) return null;
  return intents[Math.min(intents.length - 1, Math.floor(random() * intents.length))] ?? null;
}
