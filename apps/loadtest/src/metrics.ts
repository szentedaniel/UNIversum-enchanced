/**
 * The server-side half of the verdict: PromQL over the hold, split around the
 * planned restart. The spec measures the hold excluding the two minutes after
 * the restart, so every metric is read over two windows and merged:
 * percentiles and maxima take the worse window, averages are time-weighted,
 * counters add up.
 */
import type { PrometheusClient } from "#prometheus.ts";

export type PromWindows = {
  /** The run's first second (for counting server process starts). */
  runStartMs: number;
  /** The hold begins after the ramp. */
  holdStartMs: number;
  /** The SIGKILL: the first measured window ends here. */
  killMs: number;
  /** The hold ends (the last measured moment). */
  holdEndMs: number;
  /** After the restart's excluded two minutes, or `null` when nothing is left. */
  b: { endMs: number; seconds: number } | null;
};

/** Every number the verdict reads from the server's own metrics. */
export type ServerMetrics = {
  intentP95Ms: number | null;
  intentP99Ms: number | null;
  storeWriteP99Ms: number | null;
  eventLoopP99Ms: number | null;
  serverCpuCores: number | null;
  serverRssBytes: number | null;
  /** (heap at the end of the measured hold − heap 15 min earlier) / earlier. */
  heapGrowthRatio: number | null;
  rejections: Record<string, number>;
  /** Set at the last boot (so after the restart, the rooms that came back). */
  roomsRestored: number | null;
  restoreSeconds: number | null;
  /** Another cross-check of the Rooms live at the kill, from the server's own gauge. */
  roomsPlayingAtKill: number | null;
  /** Distinct `process_start_time_seconds`: 2 means only the planned restart happened. */
  serverStarts: number | null;
};

export async function collectServerMetrics(
  prom: PrometheusClient,
  windows: PromWindows,
  rejectionCodes: readonly string[],
): Promise<ServerMetrics> {
  const aSeconds = Math.max(1, Math.round((windows.killMs - windows.holdStartMs) / 1_000));
  const aEnd = windows.killMs;
  const b = windows.b;

  const windowsToRead: { endMs: number; seconds: number }[] = [{ endMs: aEnd, seconds: aSeconds }];
  if (b !== null && b.seconds > 0) windowsToRead.push(b);

  const hist = async (quantile: number, metric: string): Promise<number | null> => {
    let worst: number | null = null;
    for (const window of windowsToRead) {
      const value = await prom.instant(
        `histogram_quantile(${quantile}, sum by (le) (rate(${metric}_bucket[${Math.round(window.seconds)}s])))`,
        window.endMs,
      );
      worst = maxOf(worst, value);
    }
    return worst;
  };

  const maxOver = async (metric: string): Promise<number | null> => {
    let worst: number | null = null;
    for (const window of windowsToRead) {
      const value = await prom.instant(
        `max_over_time(${metric}[${Math.round(window.seconds)}s])`,
        window.endMs,
      );
      worst = maxOf(worst, value);
    }
    return worst;
  };

  const intentP95Ms = await scale(hist(0.95, "intent_duration_seconds"), 1_000);
  const intentP99Ms = await scale(hist(0.99, "intent_duration_seconds"), 1_000);
  const storeWriteP99Ms = await scale(hist(0.99, "room_store_write_duration_seconds"), 1_000);
  const eventLoopP99Ms = await scale(maxOver("nodejs_eventloop_lag_p99_seconds"), 1_000);
  const serverRssBytes = await maxOver("process_resident_memory_bytes");

  let cpuSeconds = 0;
  let cpuWindowSeconds = 0;
  for (const window of windowsToRead) {
    const value = await prom.instant(cpuQuery(Math.round(window.seconds)), window.endMs);
    if (value !== null) {
      cpuSeconds += value * window.seconds;
      cpuWindowSeconds += window.seconds;
    }
  }
  const serverCpuCores = cpuWindowSeconds === 0 ? null : cpuSeconds / cpuWindowSeconds;

  const rejections: Record<string, number> = {};
  for (const code of rejectionCodes) {
    let total = 0;
    for (const window of windowsToRead) {
      const value = await prom.instant(
        `sum(increase(rejections_total{code="${code}"}[${Math.round(window.seconds)}s]))`,
        window.endMs,
      );
      total += value ?? 0;
    }
    rejections[code] = total;
  }

  const heapGrowthRatio = b === null ? null : await heapGrowth(prom, b.endMs, b.seconds);
  const roomsRestored = await prom.instant("max(rooms_restored)", windows.holdEndMs);
  const restoreSeconds = await prom.instant("max(restore_duration_seconds)", windows.holdEndMs);
  const roomsPlayingAtKill = await prom.instant('sum(rooms{state="playing"})', windows.killMs);
  const startSeries = await prom.range(
    "process_start_time_seconds",
    windows.runStartMs,
    windows.holdEndMs,
    5_000,
  );
  const starts = startSeries.flat().filter((value) => value > 0);
  const serverStarts = starts.length === 0 ? null : new Set(starts).size;

  return {
    intentP95Ms,
    intentP99Ms,
    storeWriteP99Ms,
    eventLoopP99Ms,
    serverCpuCores,
    serverRssBytes,
    heapGrowthRatio,
    rejections,
    roomsRestored,
    restoreSeconds,
    roomsPlayingAtKill,
    serverStarts,
  };
}

/** The server's CPU in cores: a 1-minute rate averaged over the window (or a plain rate for short windows). */
function cpuQuery(seconds: number): string {
  return seconds < 120
    ? `rate(process_cpu_seconds_total[${seconds}s])`
    : `avg_over_time(rate(process_cpu_seconds_total[1m])[${seconds}s:1m])`;
}

async function heapGrowth(
  prom: PrometheusClient,
  endMs: number,
  windowSeconds: number,
): Promise<number | null> {
  const span = Math.min(900, windowSeconds) * 1_000;
  const startMs = endMs - span;
  const end = await prom.instant("max(nodejs_heap_size_used_bytes)", endMs);
  const start = await prom.instant("max(nodejs_heap_size_used_bytes)", startMs);
  if (end === null || start === null || start <= 0) return null;
  return (end - start) / start;
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

async function scale(value: Promise<number | null>, factor: number): Promise<number | null> {
  const resolved = await value;
  return resolved === null ? null : resolved * factor;
}
