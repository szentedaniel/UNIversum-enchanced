/**
 * The summary view-model (spec #177, ticket #237): the final Summary's figures
 * joined to the view's Players, so the panel renders names and colours with
 * `playerName` and `playerLook` (decision 8). Every figure is the engine's
 * (ADR-0001); nothing here recomputes Wealth, Rent or Value.
 */
import type { GameSummary, PlayerView } from "@universum/rules";
import type { FieldId, GroupId } from "@universum/rules/board";

/** The biggest Rent paid, with the Field it was paid on and both Players. */
export type SummaryRent = {
  payer: PlayerView;
  owner: PlayerView;
  field: FieldId;
  amount: number;
};

/** The Player who bought the most Fields, and how many. */
export type SummaryBuyer = { player: PlayerView; count: number };

/** One Monopoly formed: the Player and the Group they completed. */
export type SummaryMonopoly = { player: PlayerView; group: GroupId };

/** The result screen's Summary: the engine's figures with the view's Players. */
export type SummaryView = {
  /** `null` when no Rent was paid, or a Player in it is not in the view. */
  biggestRent: SummaryRent | null;
  /** `null` when no Player bought a Field; a tie keeps the view's earlier Player. */
  topBuyer: SummaryBuyer | null;
  /** The Monopolies in the order they were completed. */
  monopolies: SummaryMonopoly[];
  /** The Bankrupt Players, in the order they went Bankrupt (R70). */
  bankruptcies: PlayerView[];
};

/**
 * The final Summary with each figure's Player ids looked up in the view, like
 * `podiumOrder`. A figure whose Player the view does not carry is left out, so
 * the panel never renders a blank name.
 */
export function summaryView(players: readonly PlayerView[], summary: GameSummary): SummaryView {
  const byId = new Map(players.map((player) => [player.id, player]));
  const rent = summary.biggestRent;
  const payer = rent ? byId.get(rent.payer) : undefined;
  const owner = rent ? byId.get(rent.owner) : undefined;

  let topBuyer: SummaryBuyer | null = null;
  for (const player of players) {
    const count = summary.fieldsBought[player.id] ?? 0;
    if (count > 0 && (topBuyer === null || count > topBuyer.count)) {
      topBuyer = { player, count };
    }
  }

  return {
    biggestRent:
      rent && payer && owner ? { payer, owner, field: rent.field, amount: rent.amount } : null,
    topBuyer,
    monopolies: summary.monopolies.flatMap(({ player, group }): SummaryMonopoly[] => {
      const seat = byId.get(player);
      return seat ? [{ player: seat, group }] : [];
    }),
    bankruptcies: summary.bankruptcies.flatMap((id): PlayerView[] => {
      const player = byId.get(id);
      return player ? [player] : [];
    }),
  };
}
