/**
 * What a dispatch run does with the frontier: the headroom the running
 * implementers leave, and the issues that fit in it.
 */
import type { IssueFacts } from "#dispatch/frontier.ts";

/** Implementers allowed at once, unless the repo overrides it. */
export const DEFAULT_MAX_PARALLEL = 2;

export interface DispatchPlan {
  /** Issues to dispatch now, in order. */
  dispatch: IssueFacts[];
  /** Eligible issues that wait for a slot. */
  waiting: IssueFacts[];
}

/**
 * The cap minus the implementers already queued or running; never negative,
 * however many runs a cancelled dispatch left behind.
 */
export const planOf = (
  eligible: readonly IssueFacts[],
  running: number,
  maxParallel: number,
): DispatchPlan => {
  const slots = Math.max(0, maxParallel - running);
  return { dispatch: eligible.slice(0, slots), waiting: eligible.slice(slots) };
};
