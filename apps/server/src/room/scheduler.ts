/**
 * The server's clock and wake-ups, behind one seam so tests drive time by
 * hand instead of sleeping (spec: Testing). The Room reads `now()` for the
 * rules engine's `ctx.now` and schedules its Turn deadline with `at`.
 */
export type Scheduler = {
  /** Epoch ms. */
  now(): number;
  /**
   * Runs `task` once at `time` (epoch ms), or at once if `time` has passed.
   * Returns a function that cancels it.
   */
  at(time: number, task: () => void): () => void;
};

/** The real clock and Node timers. */
export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  at(time, task) {
    const timer = setTimeout(task, Math.max(0, time - Date.now()));
    return () => clearTimeout(timer);
  },
};
