/**
 * One typed config for the load test (spec: Load test). The profile is the
 * launch peak: 1,000 Rooms of 4, a 10-minute ramp, a 30-minute hold and a
 * hard kill 20 minutes into the hold. The thresholds are every pass
 * criterion, in one place; the verdict reads nothing else.
 */
import { resolve } from "node:path";

/** A `[low, high]` millisecond range, both ends inclusive. */
export type Range = readonly [number, number];

export type LoadProfile = {
  /** Rooms scheduled over the ramp. */
  rooms: number;
  /** Guests per Room (the spec's 4). */
  playersPerRoom: 2 | 3 | 4;
  /** Rooms ramp linearly from 0 to `rooms` over this long. */
  rampSeconds: number;
  /** The steady hold after the ramp, until the run ends. */
  holdSeconds: number;
  /** The SIGKILL happens this far into the hold. */
  restartAfterHoldSeconds: number;
  /** Metrics after the restart are ignored for this long (boot and rejoin noise). */
  restartExclusionSeconds: number;
  /** Every Room's Minute limit (15, as the spec asks). */
  minuteLimit: 15 | 30 | 50;
  /** Share of Rooms created with a password. */
  passwordRoomRate: number;
  /** Extra clients that only watch the Lobby list for the whole run. */
  lobbyWatchers: number;
  /** A Room's 3 joiners arrive this long after its creator. */
  joinDelayMs: Range;
  /** A Player acts this long after the view first offers a choice. */
  actionDelayMs: Range;
  /** Share of decisions left to the Turn timer. */
  timeoutRate: number;
  /** Chance a Player drops once during a game. */
  dropRate: number;
  /** Of the drops, the share that return only after a minute (by Guest token). */
  longReturnRate: number;
  /** A short drop comes back by `reconnectionToken` after this long. */
  shortReturnMs: Range;
  /** A long drop comes back by Guest token after this long (> 60 s). */
  longReturnMs: Range;
  /** When in a game's life a drop may happen, in game time. */
  dropWindowMs: Range;
  /** Seeds the whole generated profile; the same seed gives the same run. */
  seed: number;
};

/**
 * `--find-knee`: keep adding Rooms until a threshold breaks. The run starts at
 * `startRooms`, adds `roomsPerMinute` every minute, checks the last minute's
 * metrics, and reports the last count that passed. It never gates.
 */
export type KneeProfile = {
  roomsPerMinute: number;
  startRooms: number;
  maxRooms: number;
  /** How often (and over how long) the thresholds are sampled. */
  sampleSeconds: number;
};

/** Every pass criterion of the spec, with its unit implied by the name. */
export type LoadThresholds = {
  /** `intent_duration_seconds` p95 over the measured hold. */
  intentP95Ms: number;
  intentP99Ms: number;
  /** `room_store_write_duration_seconds` p99. */
  storeWriteP99Ms: number;
  /** Prometheus's event-loop lag p99 gauge. */
  eventLoopP99Ms: number;
  /** Client-side intent sent → answering view. */
  clientRttP95Ms: number;
  clientRttP99Ms: number;
  /** Server CPU in cores (the spec's 70% of one core). */
  serverCpuCores: number;
  /** Resident memory. */
  serverRssBytes: number;
  /** Heap growth over the last 15 minutes of the measured hold. */
  heapGrowthRatio: number;
  /** These Rejection codes must never appear during the measured hold. */
  rejections: Readonly<Record<"INTERNAL" | "MALFORMED" | "RATE_LIMITED" | "SLOW_DOWN", number>>;
  /** Server process exits beyond the one planned restart. */
  unplannedExits: number;
  /** Rooms that were playing at the kill but were not restored. */
  lostRooms: number;
  /** Clients that never got their own Seat back. */
  failedRejoins: number;
  /** A rejoin that landed in a different Seat. */
  seatMismatches: number;
  /** A client that saw an older state `version` after a newer one. */
  versionRegressions: number;
  /** `/readyz` after the kill. */
  readyzSeconds: number;
  /** `restore_duration_seconds` set at boot. */
  restoreSeconds: number;
  /** Every client back in its Seat, after `/readyz`. */
  reseatSeconds: number;
  /** The generator's own CPU (share of the machine) must stay below this, or the run is invalid. */
  generatorCpuFraction: number;
};

export const DEFAULT_PROFILE: LoadProfile = {
  rooms: 1_000,
  playersPerRoom: 4,
  rampSeconds: 10 * 60,
  holdSeconds: 30 * 60,
  restartAfterHoldSeconds: 20 * 60,
  restartExclusionSeconds: 2 * 60,
  minuteLimit: 15,
  passwordRoomRate: 0.1,
  lobbyWatchers: 200,
  joinDelayMs: [5_000, 30_000],
  actionDelayMs: [1_000, 5_000],
  timeoutRate: 0.05,
  dropRate: 0.1,
  longReturnRate: 0.02,
  shortReturnMs: [2_000, 30_000],
  longReturnMs: [60_000, 120_000],
  dropWindowMs: [30_000, 780_000],
  seed: 46,
};

export const THRESHOLDS: LoadThresholds = {
  intentP95Ms: 50,
  intentP99Ms: 150,
  storeWriteP99Ms: 20,
  eventLoopP99Ms: 50,
  clientRttP95Ms: 150,
  clientRttP99Ms: 300,
  serverCpuCores: 0.7,
  serverRssBytes: 1.5 * 1024 ** 3,
  heapGrowthRatio: 0.05,
  rejections: { INTERNAL: 0, MALFORMED: 0, RATE_LIMITED: 0, SLOW_DOWN: 0 },
  unplannedExits: 0,
  lostRooms: 0,
  failedRejoins: 0,
  seatMismatches: 0,
  versionRegressions: 0,
  readyzSeconds: 15,
  restoreSeconds: 10,
  reseatSeconds: 60,
  generatorCpuFraction: 0.7,
};

export const KNEE_PROFILE: KneeProfile = {
  roomsPerMinute: 100,
  startRooms: 100,
  maxRooms: 2_000,
  sampleSeconds: 60,
};

/** The client endpoint behind Caddy, which is the only origin the browser (and the generator) see. */
export function resolveEndpoint(httpPort: number, explicit: string | null): string {
  return explicit ?? `http://127.0.0.1:${httpPort}/colyseus`;
}

/** The gitignored folder at the repo root that holds each run's Markdown report. */
export function defaultReportDir(): string {
  return resolve(import.meta.dirname, "..", "..", "..", "loadtest-reports");
}
