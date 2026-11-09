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

/**
 * Probes at once, then every `intervalMs`, until the probe answers true or
 * `timeoutMs` has passed. A probe that throws is simply not ready yet.
 */
export async function pollUntil(
  probe: () => Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<{ ok: boolean; atMs: number }> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- readiness is polled, one probe at a time
      if (await probe()) return { ok: true, atMs: Date.now() };
    } catch {
      // The probe could not answer (still booting, connection refused): not ready yet.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, atMs: Date.now() };
    // oxlint-disable-next-line no-await-in-loop -- the probe interval
    await sleep(Math.min(options.intervalMs, remaining));
  }
}

/** Resolves once the wall clock reaches `atMs`; a moment in the past returns at once. */
export async function waitUntil(atMs: number): Promise<void> {
  while (Date.now() < atMs) {
    // oxlint-disable-next-line no-await-in-loop -- sleeping until a scheduled wall-clock moment
    await sleep(Math.min(1_000, atMs - Date.now()));
  }
}
