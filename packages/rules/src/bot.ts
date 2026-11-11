/**
 * The Bot policy (spec #171): one "normal" level of simple heuristics, from a
 * Player's view and the open Decision to one Player intent.
 *
 * It reads only the `publicView` a client gets — no clock, no randomness, no
 * PRNG state — so it cannot know a future Roll or Chance card. Static Board
 * data is the rules' constant, not hidden state. The Room server submits the
 * intent like any Guest's, and the engine validates it (ADR-0001, ADR-0003).
 */
import { FIELDS, MAX_LEVEL, MUSEUM_VALUE, type FieldId, type GroupId } from "#board.ts";
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

/** How many Universities of `group` the Player already owns. */
function groupOwned(
  view: PublicView,
  playerId: PlayerId,
  group: GroupId | null | undefined,
): number {
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
    const buildsMonopoly = groupOwned(view, view.currentPlayer, FIELDS[phase.field]?.group) > 0;
    return buildsMonopoly && keepsReserve(view, phase.buyout)
      ? { type: "Buyout", turn }
      : { type: "DeclineOffer", turn };
  }
  const level = phase.levels
    .filter((offer) => keepsReserve(view, offer.price))
    .toSorted((a, b) => b.level - a.level)[0];
  return level ? { type: "BuyLevel", turn, level: level.level } : { type: "DeclineOffer", turn };
}

/**
 * The Quarantine choice (R41–R46): spend a held test, buy one to leave early
 * while another round would be wasted, else roll for 12. A 12 is the only
 * free escape, and on the last round a failed roll releases the Player next
 * Turn anyway, so the test's price buys nothing there.
 */
function quarantineIntent(view: PublicView, phase: PhaseOf<"quarantineChoice">): PlayerIntent {
  const turn = view.turn;
  if (phase.canUsePcrTest) return { type: "UsePcrTest", turn };
  const rounds = playerOf(view, view.currentPlayer).quarantineRounds ?? 0;
  if (phase.canBuyPcrTest && rounds > 1) return { type: "BuyPcrTest", turn };
  return { type: "RollForTwelve", turn };
}

/**
 * The Sale (R66–R69): cover the Shortfall with the Fields the Bot can spare.
 * Whole Monopolies and the Doubler's Field go last, then the cheapest first,
 * so a shortfall costs the least Rent and never breaks a Monopoly needlessly.
 */
function saleIntent(view: PublicView, phase: PhaseOf<"selling">): PlayerIntent {
  const me = view.currentPlayer;
  const candidates = view.fields.flatMap((field, id) => {
    if (field.owner !== me) return [];
    const group = FIELDS[id]?.group;
    const monopoly =
      group !== null &&
      group !== undefined &&
      FIELDS.every((f) => f.group !== group || view.fields[f.id]?.owner === me);
    const keep = (monopoly ? 2 : 0) + (view.doubler?.field === id ? 1 : 0);
    return [{ id, sale: field.sale, keep }];
  });
  candidates.sort((a, b) => a.keep - b.keep || a.sale - b.sale || a.id - b.id);

  const fields: FieldId[] = [];
  let proceeds = 0;
  for (const candidate of candidates) {
    if (proceeds >= phase.shortfall) break;
    fields.push(candidate.id);
    proceeds += candidate.sale;
  }
  return { type: "SellFields", turn: view.turn, fields };
}

/**
 * The Doubler pick (R59–R61): the view's `rentAfter` already prices the stack
 * a placement would leave, so take the highest. A tie keeps the phase's
 * Field order.
 */
function doublerIntent(view: PublicView, phase: PhaseOf<"placingDoubler">): PlayerIntent {
  let best: { field: FieldId; rentAfter: number } | undefined;
  for (const option of view.pickOptions ?? []) {
    if (option.kind !== "doubler") continue;
    if (best === undefined || option.rentAfter > best.rentAfter) {
      best = { field: option.field, rentAfter: option.rentAfter };
    }
  }
  const field = best?.field ?? phase.fields[0];
  if (field === undefined) throw new Error("the Doubler pick offers no Field");
  return { type: "PlaceDoubler", turn: view.turn, field };
}

/**
 * The Erasmus pick (R64, R65): travel to the offered Field that best builds
 * the Bot's position — a Field that completes a Monopoly first, then one that
 * extends a Group it holds, then the most valuable landing, plus the Round
 * bonus the view lists for passing Start.
 */
function erasmusIntent(view: PublicView, phase: PhaseOf<"choosingErasmus">): PlayerIntent {
  const me = view.currentPlayer;
  let best: { field: FieldId; score: number } | undefined;
  for (const option of view.pickOptions ?? []) {
    if (option.kind !== "erasmus") continue;
    const info = FIELDS[option.field];
    const group = info?.group;
    const owned = groupOwned(view, me, group);
    const size =
      group === null || group === undefined ? 0 : FIELDS.filter((f) => f.group === group).length;
    const target = view.fields[option.field];
    const completes = target?.owner === null && size > 0 && owned === size - 1;
    let value = info?.values?.[1] ?? MUSEUM_VALUE;
    if (target?.owner === me) value = target.level >= MAX_LEVEL ? 0 : target.value + target.rent;
    const score = (completes ? 1_000_000_000 : 0) + owned * 1_000_000 + (option.bonus ?? 0) + value;
    if (best === undefined || score > best.score) best = { field: option.field, score };
  }
  const field = best?.field ?? phase.fields[0];
  if (field === undefined) throw new Error("the Erasmus pick offers no Field");
  return { type: "TravelErasmus", turn: view.turn, field };
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
    case "quarantineChoice":
      return quarantineIntent(view, view.phase);
    case "selling":
      return saleIntent(view, view.phase);
    case "placingDoubler":
      return doublerIntent(view, view.phase);
    case "choosingErasmus":
      return erasmusIntent(view, view.phase);
    // Bots answer Deals in a later ticket (#200); until then they turn every one down.
    case "dealAnswer":
      return { type: "DeclineDeal", turn };
    case "gameOver":
      return null;
    default: {
      const unhandled: never = view.phase;
      throw new Error(`the Bot has no policy for phase ${JSON.stringify(unhandled)}`);
    }
  }
}
