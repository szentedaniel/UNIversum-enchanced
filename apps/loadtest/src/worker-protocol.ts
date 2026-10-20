/**
 * Messages between the runner and its generator threads. Kept free of the
 * SDK, so both sides can import it without loading either.
 */
import type { LoadProfile } from "#config.ts";
import type { RoomPlan } from "#profile.ts";
import type { WorkerStats } from "#stats.ts";

export type WorkerConfig = {
  endpoint: string;
  /** Absolute epoch ms; every Room plan's `startAtMs` is relative to this. */
  runStartMs: number;
  stopAtMs: number;
  profile: LoadProfile;
  /** This thread's share of the ramp. */
  rooms: RoomPlan[];
  watchers: number;
  /** The shared password of the 10% password Rooms. */
  password: string;
  /** Seed offset for jitter, so threads don't act in lockstep. */
  workerIndex: number;
};

export type MainToWorker =
  | { type: "start"; config: WorkerConfig }
  /** The SIGKILL just happened; start counting who must come back. */
  | { type: "kill"; atMs: number }
  /** `/readyz` turned green; the reseat window starts now. */
  | { type: "ready"; atMs: number }
  /** Knee mode: report what happened since the previous snapshot (RTT samples are drained). */
  | { type: "snapshot" }
  | { type: "stop" };

export type WorkerToMain =
  | {
      type: "progress";
      atMs: number;
      roomsStarted: number;
      intentsSent: number;
    }
  | { type: "snapshot"; atMs: number; stats: WorkerStats }
  | { type: "done"; stats: WorkerStats };
