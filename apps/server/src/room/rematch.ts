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

/** The two Podium vote intents (ticket #223). */
export type RematchVote = "Rematch" | "WithdrawRematch";

/**
 * What made the Room re-check the agreement (ticket #225): a vote changed, a
 * Guest left the Podium, so a non-voter who is gone no longer blocks, or the
 * fixed window ran out (ticket #226).
 */
export type RematchTrigger = RematchVote | "PodiumLeft" | "RematchExpired";

/** How long the first vote waits for the rest of the table (spec #175, decision 2). */
export const REMATCH_WINDOW_MS = 30_000;

/** When the window a first vote at `firstVoteAt` opened runs out. */
export function windowExpiresAt(firstVoteAt: number): number {
  return firstVoteAt + REMATCH_WINDOW_MS;
}

/** Whether the window a first vote at `firstVoteAt` opened has run out at `now`. */
export function windowExpired(now: number, firstVoteAt: number): boolean {
  return now >= windowExpiresAt(firstVoteAt);
}

/**
 * Whether the Room keeps this Seat when it returns: its Guest agreed, or a
 * Bot holds it (a Bot neither votes nor waits).
 */
const keptByRematch = (seat: RematchSeat, votes: ReadonlySet<PlayerId>): boolean =>
  seat.bot === true || votes.has(seat.playerId);

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
  return seats.every((seat) => keptByRematch(seat, votes) || !isConnected(seat));
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
  return seats.filter((seat) => keptByRematch(seat, votes));
}
