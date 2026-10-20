/**
 * Game end (R15, R76–R79). The check runs at every Turn change (`passTurn`),
 * after the Turn's consequences and before the next Turn begins, so no Turn
 * is cut off (R75). The conditions are checked in a strict order — one Player
 * left, then the Minute limit, then a Super-monopoly, then 3 Monopolies — so
 * there is always exactly one winner (F4, F5, F25).
 */
import { FIELDS, type GroupId } from "#board.ts";
import { wealthOf } from "#rules/pricing.ts";
import type { GameState, PlayerId, PlayerState } from "#state.ts";
import { emit, setFinalPhase, type Tx } from "#tx.ts";

/** Why the game ended, which is also what the result screen says (R76–R79). */
export type GameEndReason = "lastPlayer" | "timeUp" | "superMonopoly" | "monopolies";

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * The game is over: `winner` won by `reason`. No Player can act any more,
     * and there is no deadline (the Room never wakes up for it).
     */
    gameOver: { winner: PlayerId; reason: GameEndReason };
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** The game ended (R76–R79): `winner` won by `reason`. */
    GameEnded: { winner: PlayerId; reason: GameEndReason };
  }
}

/** Ends the game: the final phase (no deadline) and the event everyone sees. */
function finish(tx: Tx, winner: PlayerId, reason: GameEndReason): void {
  // The winner is the current Player of the final state, so no Bankrupt Player
  // is ever the current Player (the one invariant that would otherwise break).
  tx.state.currentPlayer = winner;
  setFinalPhase(tx, { kind: "gameOver", winner, reason });
  emit(tx, { type: "GameEnded", winner, reason });
}

/**
 * The richest of `players`: most Wealth (R77), then more cash, then the
 * earlier Seat (F25). `players` is never empty where this is called.
 */
function richest(tx: Tx, players: readonly PlayerState[]): PlayerState | undefined {
  return players.toSorted(
    (a, b) =>
      wealthOf(tx.state, b.id) - wealthOf(tx.state, a.id) || b.cash - a.cash || a.seat - b.seat,
  )[0];
}

/** The 8 University Groups, in Board order. */
const GROUPS: readonly GroupId[] = [...new Set(FIELDS.flatMap((f) => (f.group ? [f.group] : [])))];

/** The Player owning every Museum, if any: the Super-monopoly (R78). */
function superMonopolyOwner(state: GameState, alive: readonly PlayerState[]): PlayerId | undefined {
  const owners = FIELDS.filter((f) => f.kind === "museum").map((f) => state.fields[f.id]?.owner);
  const [first] = owners;
  if (first == null || !owners.every((owner) => owner === first)) return undefined;
  return alive.some((player) => player.id === first) ? first : undefined;
}

/** How many Groups the Player owns every University of (R79); Museums are no Group. */
function monopoliesOf(state: GameState, playerId: PlayerId): number {
  return GROUPS.filter((group) =>
    FIELDS.filter((f) => f.group === group).every((f) => state.fields[f.id]?.owner === playerId),
  ).length;
}

/**
 * The Player holding 3 or more Monopolies (R79). Should two hold that many,
 * the one with more of them wins, then the Wealthier, then the earlier Seat.
 */
function mostMonopolies(tx: Tx, alive: readonly PlayerState[]): PlayerState | undefined {
  const holders = alive
    .map((player) => ({ player, monopolies: monopoliesOf(tx.state, player.id) }))
    .filter(({ monopolies }) => monopolies >= 3)
    .toSorted(
      (a, b) =>
        b.monopolies - a.monopolies ||
        wealthOf(tx.state, b.player.id) - wealthOf(tx.state, a.player.id) ||
        b.player.cash - a.player.cash ||
        a.player.seat - b.player.seat,
    );
  return holders[0]?.player;
}

/**
 * The game-end check (R76–R79), at the Turn change. Returns whether the game
 * ended; when it did, the Turn does not pass.
 */
export function checkGameEnd(tx: Tx): boolean {
  if (tx.state.phase.kind === "gameOver") return true;
  const alive = tx.state.players.filter((player) => !player.bankrupt);
  if (alive.length <= 1) {
    // Only one Player left, or (unreachable through play) none at all.
    const winner = alive[0] ?? richest(tx, tx.state.players);
    if (winner) finish(tx, winner.id, "lastPlayer");
    return true;
  }
  if (tx.ctx.now >= tx.state.endsAt) {
    const winner = richest(tx, alive);
    if (winner) finish(tx, winner.id, "timeUp");
    return true;
  }
  const superMonopoly = superMonopolyOwner(tx.state, alive);
  if (superMonopoly !== undefined) {
    finish(tx, superMonopoly, "superMonopoly");
    return true;
  }
  const monopolist = mostMonopolies(tx, alive);
  if (monopolist) {
    finish(tx, monopolist.id, "monopolies");
    return true;
  }
  return false;
}
