/**
 * The working copy one `apply` call mutates. `apply` deep-copies the incoming
 * state first, so rule code can assign to `tx.state` freely while `apply` stays
 * pure from the outside. Rule areas talk to the engine only through these
 * helpers, so cross-cutting changes (deadlines for every phase, #25) land here.
 */
import type { GameEvent } from "#events.ts";
import type { Ctx } from "#intents.ts";
import type { GameState, Phase, PlayerId, PlayerState } from "#state.ts";
import { revealOf, type Reveal } from "#view.ts";

export type Tx = {
  state: GameState;
  /** Events in the order they happened. */
  events: GameEvent[];
  /**
   * One snapshot of the board per event, in the same order: what the Player
   * cards and the Board show at that event's Playback step (ADR-0005).
   */
  reveals: Reveal[];
  ctx: Ctx;
  /** Set by `decide`: the intent stops at a Player decision instead of passing the Turn. */
  decided: boolean;
  /**
   * Set by `setPhase`: the intent reached a phase, so `apply` fixes the new
   * decision's deadline once the event list (and so the Playback) is complete.
   */
  phaseSet: boolean;
  /** Set by `setFinalPhase`: the phase reached is final, so it has no deadline. */
  finalPhase: boolean;
};

/**
 * Records an event and the board it leaves behind. Rule code applies its
 * effect before emitting, so the reveal shows what that event did; the next
 * event's reveal shows the next change (ADR-0005).
 */
export function emit(tx: Tx, event: GameEvent): void {
  tx.events.push(event);
  tx.reveals.push(revealOf(tx.state));
}

/**
 * Moves the game to `phase`. Every phase change goes through here, so `apply`
 * knows to fix the deadline once the intent's Playback is known (R17, ADR-0004).
 */
export function setPhase(tx: Tx, phase: Phase): void {
  tx.state.phase = phase;
  tx.phaseSet = true;
}

/** Stops the intent at a Player decision: the phase lists the options. */
export function decide(tx: Tx, phase: Phase): void {
  setPhase(tx, phase);
  tx.decided = true;
}

/**
 * A phase the game never leaves because it is over (R80): a phase change with
 * no deadline, so the Room schedules no wake-up for it.
 */
export function setFinalPhase(tx: Tx, phase: Phase): void {
  setPhase(tx, phase);
  tx.finalPhase = true;
}

export function playerById(tx: Tx, playerId: PlayerId): PlayerState {
  const player = tx.state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown Player ${playerId}`);
  return player;
}
