/**
 * The wait before reconnect attempt `attempt` (1, 2, …): exponential from
 * `base` up to `max`, with "equal jitter" (half of it fixed, half random), so
 * a restarted server isn't hit by every client at the same moment.
 */
export function backoffDelay(
  attempt: number,
  base: number,
  max: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return exponential / 2 + (random() * exponential) / 2;
}
