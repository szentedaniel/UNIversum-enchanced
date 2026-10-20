import type { PlayerId, PlayerView } from "@universum/rules";

/** One Player on the result screen, with their place (1 is the winner). */
export type PodiumEntry = { player: PlayerView; place: number };

/** Most Wealth first, then more cash, then the earlier Seat (R77, F25). */
function byWealth(a: PlayerView, b: PlayerView): number {
  return b.wealth - a.wealth || b.cash - a.cash || a.seat - b.seat;
}

/**
 * The result screen's ranking (R80): the winner the server named, then every
 * other non-Bankrupt Player by Wealth (ties: more cash, then the earlier
 * Seat), then the Bankrupt Players. Places 1–3 stand on the podium; the rest
 * are listed below it.
 */
export function podiumOrder(players: readonly PlayerView[], winner: PlayerId): PodiumEntry[] {
  const rest = players.filter((player) => player.id !== winner);
  const ordered = [
    ...players.filter((player) => player.id === winner),
    ...rest.filter((player) => !player.bankrupt).toSorted(byWealth),
    ...rest.filter((player) => player.bankrupt).toSorted(byWealth),
  ];
  return ordered.map((player, index) => ({ player, place: index + 1 }));
}
