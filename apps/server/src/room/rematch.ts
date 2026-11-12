/**
 * The rematch votes of one Room (spec #175, decision 6): public Player ids
 * kept in Room memory only, never in the store. A vote keys on the Player, not
 * the connection, so a reconnect keeps it.
 */
import type { PlayerId } from "@universum/rules";

/**
 * The part of a Seat the rematch rules read: its Player, and whether a Bot
 * holds it. A Bot has no vote and nobody waiting for it.
 */
export type RematchSeat = { playerId: PlayerId; bot?: boolean };

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

/**
 * Whether the Room returns to Lobby state (spec #175): at least one vote is
 * cast, and every Guest Seat with a live connection has voted. A dropped
 * Guest's Seat does not block the others and is released; a Bot Seat neither
 * votes nor blocks.
 */
export function shouldReturn<S extends RematchSeat>(
  seats: readonly S[],
  votes: ReadonlySet<PlayerId>,
  isConnected: (seat: S) => boolean,
): boolean {
  if (votes.size === 0) return false;
  return seats.every(
    (seat) => seat.bot === true || votes.has(seat.playerId) || !isConnected(seat),
  );
}

/**
 * The Seats the Room keeps when it returns to Lobby state: the Guest Seats
 * whose Player voted and every Bot Seat, in join order, unchanged. The others
 * are released back to the Lobby.
 */
export function seatsAfterRematch<S extends RematchSeat>(
  seats: readonly S[],
  votes: ReadonlySet<PlayerId>,
): S[] {
  return seats.filter((seat) => seat.bot === true || votes.has(seat.playerId));
}
