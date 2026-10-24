/**
 * The load test's waits and deadlines. One implementation for the runner, the
 * generator threads and the compose helpers, so every wait behaves the same
 * and a timeout never leaves its timer behind.
 */

/** Resolves after `ms` (Node timers may return a millisecond early). */
export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** `promise`, or a rejection after `ms`; the timer never outlives the wait. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: timedOut, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error("timed out")), ms);
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}
