/**
 * The Deal composer's rules (spec #172, #194): who this client may put a Deal
 * to, which Fields each side may put in, and whether a draft is a valid
 * proposal. Everything comes from the pushed view, so the composer offers only
 * what the rules would accept; the engine validates again on the server.
 */
import type { DealSide, IntentOf, PlayerId, PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";

/** A Deal being composed: the recipient and what each side puts in. */
export type DealDraft = {
  recipient: PlayerId | null;
  /** What this client gives. */
  give: DealSide;
  /** What this client asks the recipient for. */
  take: DealSide;
};

/** Why a draft is not a valid Deal; the composer shows the matching message. */
export type DealProblem = "recipient" | "empty" | "field" | "cash";

/** Every other active Player this client may put a Deal to, in Seat order. */
export function dealRecipients(view: PublicView, me: PlayerId): PlayerId[] {
  return view.players
    .filter((player) => player.id !== me && !player.bankrupt)
    .map((player) => player.id);
}

/** The Fields `owner` holds, in Board order; empty for `null` or a Player without any. */
export function dealFields(view: PublicView, owner: PlayerId | null): FieldId[] {
  if (owner === null) return [];
  return view.fields.flatMap((field, id) => (field.owner === owner ? [id] : []));
}

/** A Player's cash, and 0 when the view does not carry them. */
export function dealCash(view: PublicView, player: PlayerId | null): number {
  return view.players.find((candidate) => candidate.id === player)?.cash ?? 0;
}

/**
 * Why the draft is not a valid Deal, or `null` when it is: an active other
 * recipient, Fields each side owns (never the same Field twice), cash each
 * payer covers, and at least one Field or some cash.
 */
export function dealProblem(view: PublicView, me: PlayerId, draft: DealDraft): DealProblem | null {
  const { recipient, give, take } = draft;
  if (recipient === null || !dealRecipients(view, me).includes(recipient)) return "recipient";
  const fields = [...give.fields, ...take.fields];
  if (new Set(fields).size !== fields.length) return "field";
  const mine = new Set(dealFields(view, me));
  if (give.fields.some((field) => !mine.has(field))) return "field";
  const theirs = new Set(dealFields(view, recipient));
  if (take.fields.some((field) => !theirs.has(field))) return "field";
  const cashOf = (side: DealSide, payer: string): boolean =>
    !Number.isInteger(side.cash) || side.cash < 0 || side.cash > dealCash(view, payer);
  if (cashOf(give, me) || cashOf(take, recipient)) return "cash";
  if (fields.length === 0 && give.cash === 0 && take.cash === 0) return "empty";
  return null;
}

/** The `ProposeDeal` intent for a valid draft, or `null` when the draft is not one. */
export function dealProposal(
  view: PublicView,
  me: PlayerId,
  draft: DealDraft,
): IntentOf<"ProposeDeal"> | null {
  const recipient = draft.recipient;
  if (recipient === null || dealProblem(view, me, draft) !== null) return null;
  return {
    type: "ProposeDeal",
    turn: view.turn,
    recipient,
    give: { fields: [...draft.give.fields], cash: draft.give.cash },
    take: { fields: [...draft.take.fields], cash: draft.take.cash },
  };
}
