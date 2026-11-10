/**
 * The Bot policy (spec #171): one "normal" level of simple heuristics, from a
 * Player's view and the open Decision to one Player intent.
 *
 * It reads only the `publicView` a client gets — no clock, no randomness, no
 * PRNG state — so it cannot know a future Roll or Chance card. Static Board
 * data is the rules' constant, not hidden state. The Room server submits the
 * intent like any Guest's, and the engine validates it (ADR-0001, ADR-0003).
 */
import { FIELDS, type FieldId, type GroupId } from "#board.ts";
import type { PlayerIntent } from "#intents.ts";
import type { PhaseOf, PlayerId } from "#state.ts";
import type { PublicView } from "#view.ts";

/** Cash the Bot keeps back when it spends, for Rent and the Timeout penalty. */
const CASH_RESERVE = 500_000;

function playerOf(view: PublicView, playerId: PlayerId) {
  const player = view.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`no Player ${playerId} in the view`);
  return player;
}

/** How many Universities of `field`'s Group the Player already owns. */
function groupProgress(view: PublicView, playerId: PlayerId, field: FieldId): number {
  const group: GroupId | null | undefined = FIELDS[field]?.group;
  if (group === null || group === undefined) return 0;
  return FIELDS.filter((f) => f.group === group && view.fields[f.id]?.owner === playerId).length;
}

/** Whether paying `price` leaves the Bot at least its cash reserve. */
function keepsReserve(view: PublicView, price: number): boolean {
  return playerOf(view, view.currentPlayer).cash - price >= CASH_RESERVE;
}

/**
 * The Offer (R47–R54, R58): buy or build with the reserve kept, and buy a
 * Buyout only where it builds the Bot's Monopoly. The offered Levels cost
 * exactly their Value difference, so taking the highest affordable one raises
 * the Rent sooner without spending more.
 */
function offerIntent(view: PublicView, phase: PhaseOf<"offer">): PlayerIntent {
  const turn = view.turn;
  if (phase.museum !== undefined) {
    return keepsReserve(view, phase.museum)
      ? { type: "BuyMuseum", turn }
      : { type: "DeclineOffer", turn };
  }
  if (phase.buyout !== undefined) {
    const buildsMonopoly = groupProgress(view, view.currentPlayer, phase.field) > 0;
    return buildsMonopoly && keepsReserve(view, phase.buyout)
      ? { type: "Buyout", turn }
      : { type: "DeclineOffer", turn };
  }
  const level = phase.levels
    .filter((offer) => keepsReserve(view, offer.price))
    .toSorted((a, b) => b.level - a.level)[0];
  return level
    ? { type: "BuyLevel", turn, level: level.level }
    : { type: "DeclineOffer", turn };
}

/**
 * The intent a Bot submits for the open Decision, or `null` once the game is
 * over. The switch is exhaustive: a new phase fails to compile until the
 * policy covers it.
 */
export function botIntent(view: PublicView): PlayerIntent | null {
  const turn = view.turn;
  switch (view.phase.kind) {
    case "awaitingRoll":
      return { type: "Roll", turn };
    case "offer":
      return offerIntent(view, view.phase);
    case "gameOver":
      return null;
    default: {
      const unhandled: never = view.phase;
      throw new Error(`the Bot has no policy for phase ${JSON.stringify(unhandled)}`);
    }
  }
}
