/**
 * The working copy one `apply` call mutates. `apply` deep-copies the incoming
 * state first, so rule code can assign to `tx.state` freely while `apply` stays
 * pure from the outside. Rule areas talk to the engine only through these
 * helpers, so cross-cutting changes (deadlines for every phase, #25) land here.
 */
import { turnDeadlineFrom } from "#constants.ts";
import type { GameEvent } from "#events.ts";
import type { Ctx } from "#intents.ts";
import type { GameState, Phase, PlayerId, PlayerState } from "#state.ts";

export type Tx = {
  state: GameState;
  /** Events in the order they happened. */
  events: GameEvent[];
  ctx: Ctx;
  /** Set by `decide`: the intent stops at a Player decision instead of passing the Turn. */
  decided: boolean;
};

export function emit(tx: Tx, event: GameEvent): void {
  tx.events.push(event);
}

/**
 * Moves the game to `phase`. Every phase change goes through here, so every
 * decision gets a fresh deadline (R17).
 */
export function setPhase(tx: Tx, phase: Phase): void {
  tx.state.phase = phase;
  tx.state.turnDeadline = turnDeadlineFrom(tx.ctx.now, tx.ctx.turnLimitMs);
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
  tx.state.turnDeadline = null;
}

export function playerById(tx: Tx, playerId: PlayerId): PlayerState {
  const player = tx.state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown Player ${playerId}`);
  return player;
}
