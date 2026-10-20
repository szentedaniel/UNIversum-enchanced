import type { PlayerView, Standing } from "@universum/rules";

/** One Player on the result screen, with their place (1 is the winner). */
export type PodiumEntry = { player: PlayerView; place: number };

/**
 * The result screen's ranking (R80): the server's standings order (the winner
 * first, then by Wealth, the Bankrupt last), looked up in the view's Players
 * for their figure, name and colour. The client holds no rule logic.
 */
export function podiumOrder(
  players: readonly PlayerView[],
  standings: readonly Standing[],
): PodiumEntry[] {
  const byId = new Map(players.map((player) => [player.id, player]));
  return standings.flatMap((standing, index) => {
    const player = byId.get(standing.player);
    return player ? [{ player, place: index + 1 }] : [];
  });
}
