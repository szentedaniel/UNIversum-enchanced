/**
 * The rematch votes of one Room (spec #175, decision 6): public Player ids
 * kept in Room memory only, never in the store. A vote keys on the Player, not
 * the connection, so a reconnect keeps it.
 */
import type { PlayerId } from "@universum/rules";

/** Adds a vote; one already cast is harmless. */
export function castVote(votes: ReadonlySet<PlayerId>, playerId: PlayerId): Set<PlayerId> {
  return new Set(votes).add(playerId);
}

/** Takes a vote back; one that was never cast is harmless. */
export function withdrawVote(votes: ReadonlySet<PlayerId>, playerId: PlayerId): Set<PlayerId> {
  const next = new Set(votes);
  next.delete(playerId);
  return next;
}

/** The agreed Player ids in Seat order, ignoring a vote whose Player has no Seat any more. */
export function votersOf(
  votes: ReadonlySet<PlayerId>,
  seats: readonly { playerId: PlayerId }[],
): PlayerId[] {
  return seats.filter((seat) => votes.has(seat.playerId)).map((seat) => seat.playerId);
}
