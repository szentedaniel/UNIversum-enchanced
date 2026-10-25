/**
 * Turning the generator's raw observations into the numbers the verdict and
 * the report need: exact percentiles from the collected round trips, summed
 * counters across workers, and the generator's own CPU peak.
 */
export type RejectionCounts = Record<string, number>;

/** What one worker thread observed over the run. */
export type WorkerStats = {
  /** Exact client round trips (intent sent → the answering view), in ms. */
  rttMs: number[];
  /** The UTF-8 byte length of each `game` push received, re-encoded as JSON. */
  pushBytes: number[];
  intentsSent: number;
  intentsAccepted: number;
  rejections: RejectionCounts;
  /** Decisions the bot made (including the ones it left to the timer). */
  decisions: number;
  /** Decisions deliberately skipped so the Turn timer fires. */
  timeouts: number;
  drops: number;
  shortDrops: number;
  longDrops: number;
  /** Rejoins that used the SDK's `reconnectionToken`. */
  tokenRejoins: number;
  /** Rejoins that used the Guest token (after > 60 s, or after a restart). */
  guestRejoins: number;
  failedRejoins: number;
  seatMismatches: number;
  versionRegressions: number;
  /** Sockets that closed when the run had not asked them to. */
  unplannedExits: number;
  roomsStarted: number;
  gamesFinished: number;
  /** Rooms playing at the kill that must be restored. */
  roomsAtKill: number;
  /** Seats expected to come back after the planned kill. */
  clientsAtKill: number;
  /** Of those, back within the reseat window after `/readyz`. */
  clientsBackInTime: number;
  /** The slowest Seat's return, after `/readyz`. */
  maxRejoinAfterReadyMs: number | null;
  /** CPU seconds used in each sampling interval, timestamped at its end. */
  cpuSamples: CpuSample[];
  errors: string[];
};

export type CpuSample = { at: number; seconds: number };

/** The merged client-side numbers the verdict reads. */
export type ClientSummary = Omit<WorkerStats, "rttMs" | "pushBytes" | "cpuSamples"> & {
  rttSamples: number;
  rttP95Ms: number | null;
  rttP99Ms: number | null;
  maxRttMs: number | null;
  /** Game pushes measured (`game` pushes received). */
  pushSamples: number;
  pushP50Bytes: number | null;
  pushP95Bytes: number | null;
  maxPushBytes: number | null;
  /** The generator's own CPU, as a share of the whole machine. */
  generatorCpuPeakFraction: number;
};

export function emptyWorkerStats(): WorkerStats {
  return {
    rttMs: [],
    pushBytes: [],
    intentsSent: 0,
    intentsAccepted: 0,
    rejections: {},
    decisions: 0,
    timeouts: 0,
    drops: 0,
    shortDrops: 0,
    longDrops: 0,
    tokenRejoins: 0,
    guestRejoins: 0,
    failedRejoins: 0,
    seatMismatches: 0,
    versionRegressions: 0,
    unplannedExits: 0,
    roomsStarted: 0,
    gamesFinished: 0,
    roomsAtKill: 0,
    clientsAtKill: 0,
    clientsBackInTime: 0,
    maxRejoinAfterReadyMs: null,
    cpuSamples: [],
    errors: [],
  };
}

/**
 * The size of a message the SDK handed the worker, as the UTF-8 byte length of
 * its JSON encoding. The wire itself is msgpack, and the SDK decodes it before
 * `onMessage`, so this is a comparable size of the same payload, not the raw
 * frame: it names no field, so a push that grows (e.g. one reveal per event)
 * needs no change here.
 */
export function jsonBytes(message: object): number {
  return Buffer.byteLength(JSON.stringify(message));
}

/** The nearest-rank percentile: the smallest sample at or above `p`% of the rest. */
export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = samples.toSorted((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

/** The largest sample; `null` without samples. */
export function maxOf(samples: number[]): number | null {
  return samples.reduce<number | null>(
    (max, value) => (max === null || value > max ? value : max),
    null,
  );
}

const CPU_SAMPLE_MS = 5_000;

/**
 * The generator's peak CPU over any sampling interval, as a share of the
 * machine's cores. Every worker samples its own CPU every 5 s; samples in the
 * same interval are added, so concurrent workers count together.
 */
export function peakCpuFraction(samples: CpuSample[], cpuCount: number): number {
  if (samples.length === 0) return 0;
  const buckets = new Map<number, number>();
  for (const sample of samples) {
    const bucket = Math.round(sample.at / CPU_SAMPLE_MS);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + sample.seconds);
  }
  let peak = 0;
  for (const seconds of buckets.values()) {
    peak = Math.max(peak, seconds / ((CPU_SAMPLE_MS / 1_000) * Math.max(1, cpuCount)));
  }
  return peak;
}

export function mergeWorkerStats(
  workers: WorkerStats[],
  options: { cpuCount: number },
): ClientSummary {
  const rtt = workers.flatMap((worker) => worker.rttMs);
  const push = workers.flatMap((worker) => worker.pushBytes);
  const rejections: RejectionCounts = {};
  let maxRejoinAfterReadyMs: number | null = null;
  for (const worker of workers) {
    for (const [code, count] of Object.entries(worker.rejections)) {
      rejections[code] = (rejections[code] ?? 0) + count;
    }
    if (
      worker.maxRejoinAfterReadyMs !== null &&
      (maxRejoinAfterReadyMs === null || worker.maxRejoinAfterReadyMs > maxRejoinAfterReadyMs)
    ) {
      maxRejoinAfterReadyMs = worker.maxRejoinAfterReadyMs;
    }
  }
  return {
    rttSamples: rtt.length,
    rttP95Ms: percentile(rtt, 95),
    rttP99Ms: percentile(rtt, 99),
    maxRttMs: maxOf(rtt),
    pushSamples: push.length,
    pushP50Bytes: percentile(push, 50),
    pushP95Bytes: percentile(push, 95),
    maxPushBytes: maxOf(push),
    intentsSent: sum(workers, (worker) => worker.intentsSent),
    intentsAccepted: sum(workers, (worker) => worker.intentsAccepted),
    rejections,
    decisions: sum(workers, (worker) => worker.decisions),
    timeouts: sum(workers, (worker) => worker.timeouts),
    drops: sum(workers, (worker) => worker.drops),
    shortDrops: sum(workers, (worker) => worker.shortDrops),
    longDrops: sum(workers, (worker) => worker.longDrops),
    tokenRejoins: sum(workers, (worker) => worker.tokenRejoins),
    guestRejoins: sum(workers, (worker) => worker.guestRejoins),
    failedRejoins: sum(workers, (worker) => worker.failedRejoins),
    seatMismatches: sum(workers, (worker) => worker.seatMismatches),
    versionRegressions: sum(workers, (worker) => worker.versionRegressions),
    unplannedExits: sum(workers, (worker) => worker.unplannedExits),
    roomsStarted: sum(workers, (worker) => worker.roomsStarted),
    gamesFinished: sum(workers, (worker) => worker.gamesFinished),
    roomsAtKill: sum(workers, (worker) => worker.roomsAtKill),
    clientsAtKill: sum(workers, (worker) => worker.clientsAtKill),
    clientsBackInTime: sum(workers, (worker) => worker.clientsBackInTime),
    maxRejoinAfterReadyMs,
    generatorCpuPeakFraction: peakCpuFraction(
      workers.flatMap((worker) => worker.cpuSamples),
      options.cpuCount,
    ),
    errors: [
      ...new Set(workers.flatMap((worker) => worker.errors).map((error) => error.slice(0, 300))),
    ].slice(0, 20),
  };
}

function sum(workers: WorkerStats[], pick: (worker: WorkerStats) => number): number {
  return workers.reduce((total, worker) => total + pick(worker), 0);
}
