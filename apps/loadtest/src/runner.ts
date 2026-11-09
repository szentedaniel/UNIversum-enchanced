/**
 * The run: compose up, the ramp and hold, the SIGKILL mid-hold, then the
 * verdict from Prometheus and the generators' own checks. `--find-knee` runs
 * the same stack without the kill and adds 100 Rooms a minute until a
 * threshold breaks.
 */
import { execFileSync } from "node:child_process";
import { availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { Worker } from "node:worker_threads";
import type { RunOptions } from "#args.ts";
import { DEFAULT_PROFILE, THRESHOLDS, type LoadProfile } from "#config.ts";
import { Compose } from "#docker.ts";
import { collectServerMetrics, type PromWindows, type ServerMetrics } from "#metrics.ts";
import { kneeRoomPlans, roomPlans, type RoomPlan } from "#profile.ts";
import { PrometheusClient } from "#prometheus.ts";
import { writeReport, type KneeResult, type RunReport } from "#report.ts";
import { emptyWorkerStats, mergeWorkerStats, type WorkerStats } from "#stats.ts";
import { verdict, type RestartMeasurements, type Verdict } from "#verdict.ts";
import { pollUntil, waitUntil, withTimeout } from "#wait.ts";
import type { MainToWorker, WorkerConfig, WorkerToMain } from "#worker-protocol.ts";

type WorkerHandle = {
  worker: Worker;
  index: number;
  stats: WorkerStats | null;
  done: Promise<WorkerStats>;
  resolveDone: (stats: WorkerStats) => void;
  rejectDone: (error: Error) => void;
  snapshotWaiters: ((stats: WorkerStats) => void)[];
  progress: { roomsStarted: number; intentsSent: number };
};

export async function runLoadTest(options: RunOptions): Promise<number> {
  return options.knee === null ? runFull(options) : runKnee(options);
}

async function runFull(options: RunOptions): Promise<number> {
  const { profile } = options;
  const startedAt = new Date();
  const sha = gitSha();
  const compose = new Compose(options, sha.slice(0, 7), log);
  const prometheus = new PrometheusClient(`http://127.0.0.1:${options.prometheusPort}`);
  let handles: WorkerHandle[] = [];
  let reportPath: string | null = null;
  let exitCode = 1;

  try {
    log(
      `${profile.rooms} Rooms × ${profile.playersPerRoom}: ${minutes(profile.rampSeconds)} ramp, ${minutes(
        profile.holdSeconds,
      )} hold, kill at ${minutes(profile.restartAfterHoldSeconds)}`,
    );
    for (const warning of options.warnings) log(`warning: ${warning}`);

    await compose.down();
    await compose.up(options.build);
    await waitForPrometheus(`http://127.0.0.1:${options.prometheusPort}`, 60_000);

    const plans = roomPlans(profile);
    const runStartMs = Date.now() + 3_000;
    const holdStartMs = runStartMs + profile.rampSeconds * 1_000;
    const killAtMs = holdStartMs + profile.restartAfterHoldSeconds * 1_000;
    const holdEndMs = holdStartMs + profile.holdSeconds * 1_000;

    handles = spawnWorkers(options, plans, runStartMs, holdEndMs);
    log(`generator started: ${options.workers} workers, endpoint ${options.endpoint}`);

    const progress = setInterval(() => {
      const rooms = handles.reduce((total, handle) => total + handle.progress.roomsStarted, 0);
      const intents = handles.reduce((total, handle) => total + handle.progress.intentsSent, 0);
      log(`progress: ${rooms} Rooms started, ${intents} intents sent`);
    }, 30_000);

    await waitUntil(killAtMs);
    const killedAtMs = Date.now();
    sendAll(handles, { type: "kill", atMs: killedAtMs });
    log("SIGKILL server");
    await compose.killServer();
    const ready = await compose.waitUntilReady(120_000);
    log(
      slower(
        ready.ready
          ? `/readyz after ${((ready.atMs - killedAtMs) / 1_000).toFixed(1)} s`
          : "/readyz did not turn green within 120 s",
        (ready.atMs - killedAtMs) / 1_000,
        THRESHOLDS.readyzSeconds,
      ),
    );
    sendAll(handles, { type: "ready", atMs: ready.atMs });

    await waitUntil(holdEndMs);
    clearInterval(progress);
    const workerStats = await stopWorkers(handles);
    handles = [];

    const bStart = ready.atMs + profile.restartExclusionSeconds * 1_000;
    const windows: PromWindows = {
      runStartMs,
      holdStartMs,
      killMs: killedAtMs,
      holdEndMs,
      b:
        holdEndMs > bStart
          ? { endMs: holdEndMs, seconds: Math.round((holdEndMs - bStart) / 1_000) }
          : null,
    };
    const server = await collectServerMetrics(
      prometheus,
      windows,
      Object.keys(THRESHOLDS.rejections),
    );
    const client = mergeWorkerStats(workerStats, { cpuCount: availableParallelism() });
    const restart: RestartMeasurements = {
      readyzSeconds: (ready.atMs - killedAtMs) / 1_000,
      restoreSeconds: server.restoreSeconds,
      roomsRestored: server.roomsRestored,
      roomsLiveAtKill: client.roomsAtKill,
      clientsAtKill: client.clientsAtKill,
      clientsBackInTime: client.clientsBackInTime,
      maxRejoinAfterReadyMs: client.maxRejoinAfterReadyMs,
      serverStarts: server.serverStarts,
    };
    const result = verdict({ thresholds: THRESHOLDS, server, client, restart });
    printVerdict(result);

    const report: RunReport = {
      mode: isDefaultProfile(profile) ? "full" : "scaled",
      startedAt,
      gitSha: sha,
      host: hostInfo(),
      options: {
        endpoint: options.endpoint,
        httpPort: options.httpPort,
        prometheusPort: options.prometheusPort,
        projectName: options.projectName,
      },
      profile,
      knee: null,
      windows,
      server,
      client,
      restart,
      verdict: result,
      durationSeconds: (Date.now() - runStartMs) / 1_000,
      warnings: options.warnings,
    };
    reportPath = writeReport(options.reportDir, report);
    log(`report: ${reportPath}`);
    exitCode = result.pass ? 0 : 1;
    return exitCode;
  } finally {
    if (handles.length > 0) await stopWorkers(handles);
    if (!options.keep) await compose.down();
    else log("leaving the compose stack up (--keep)");
  }
}

async function runKnee(options: RunOptions): Promise<number> {
  const knee = options.knee;
  if (knee === null) throw new Error("runKnee without a knee profile");
  const startedAt = new Date();
  const sha = gitSha();
  const compose = new Compose(options, sha.slice(0, 7), log);
  const prometheus = new PrometheusClient(`http://127.0.0.1:${options.prometheusPort}`);
  let handles: WorkerHandle[] = [];

  try {
    log(
      `find-knee: +${knee.roomsPerMinute} Rooms/min from ${knee.startRooms}, up to ${knee.maxRooms}`,
    );
    await compose.down();
    await compose.up(options.build);
    await waitForPrometheus(`http://127.0.0.1:${options.prometheusPort}`, 60_000);

    const plans = kneeRoomPlans(knee);
    const runStartMs = Date.now() + 3_000;
    const plannedSeconds =
      ((knee.maxRooms - knee.startRooms) / knee.roomsPerMinute) * 60 + knee.sampleSeconds;
    const stopAtMs = runStartMs + plannedSeconds * 1_000;
    handles = spawnWorkers(options, plans, runStartMs, stopAtMs);
    log(`generator started: ${options.workers} workers`);

    let lastPassingRooms = 0;
    let breakingCriterion: string | null = null;
    let samples = 0;
    let lastVerdict: Verdict | null = null;
    let lastServer: ServerMetrics | null = null;
    const sampleCount = Math.ceil(plannedSeconds / knee.sampleSeconds) + 1;
    for (let sample = 1; sample <= sampleCount; sample++) {
      const at = runStartMs + sample * knee.sampleSeconds * 1_000;
      // oxlint-disable-next-line no-await-in-loop -- samples are taken one minute at a time
      await waitUntil(at);
      // oxlint-disable-next-line no-await-in-loop -- every worker reports this sample's numbers
      const snapshots = await Promise.all(handles.map((handle) => requestSnapshot(handle)));
      const client = mergeWorkerStats(snapshots, { cpuCount: availableParallelism() });
      const windows: PromWindows = {
        runStartMs,
        holdStartMs: at - knee.sampleSeconds * 1_000,
        killMs: at,
        holdEndMs: at,
        b: null,
      };
      // oxlint-disable-next-line no-await-in-loop -- the verdict needs this sample's metrics
      const server = await collectServerMetrics(
        prometheus,
        windows,
        Object.keys(THRESHOLDS.rejections),
      );
      const result = verdict({
        thresholds: THRESHOLDS,
        server,
        client,
        restart: noRestart(),
      });
      samples = sample;
      lastVerdict = result;
      lastServer = server;
      const started = startedRooms(plans, runStartMs, at);
      log(`knee sample ${sample}: ${started} Rooms started — ${result.pass ? "PASS" : "FAIL"}`);
      if (!result.pass) {
        breakingCriterion = result.criteria.find((row) => row.status === "fail")?.id ?? "unknown";
        break;
      }
      lastPassingRooms = started;
      if (started >= plans.length) break;
    }

    const finalStats = await stopWorkers(handles);
    handles = [];
    const client = mergeWorkerStats(finalStats, { cpuCount: availableParallelism() });
    const result =
      lastVerdict ??
      verdict({ thresholds: THRESHOLDS, server: emptyServer(), client, restart: noRestart() });
    const kneeResult: KneeResult = {
      lastPassingRooms,
      startedRooms: client.roomsStarted,
      breakingCriterion,
      samples,
    };
    printVerdict(result);
    log(`find-knee: last passing count ${kneeResult.lastPassingRooms} Rooms (never gates)`);
    const report: RunReport = {
      mode: "knee",
      startedAt,
      gitSha: sha,
      host: hostInfo(),
      options: {
        endpoint: options.endpoint,
        httpPort: options.httpPort,
        prometheusPort: options.prometheusPort,
        projectName: options.projectName,
      },
      profile: options.profile,
      knee,
      windows: null,
      server: lastServer ?? emptyServer(),
      client,
      restart: noRestart(),
      verdict: result,
      durationSeconds: (Date.now() - runStartMs) / 1_000,
      warnings: options.warnings,
      kneeResult,
    };
    log(`report: ${writeReport(options.reportDir, report)}`);
    // A knee search is exploratory: it reports, it never gates.
    return 0;
  } finally {
    if (handles.length > 0) await stopWorkers(handles);
    if (!options.keep) await compose.down();
    else log("leaving the compose stack up (--keep)");
  }
}

function spawnWorkers(
  options: RunOptions,
  plans: RoomPlan[],
  runStartMs: number,
  stopAtMs: number,
): WorkerHandle[] {
  const count = Math.min(Math.max(1, options.workers), Math.max(1, plans.length));
  return Array.from({ length: count }, (_, index) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    const {
      promise: done,
      resolve: resolveDone,
      reject: rejectDone,
    } = Promise.withResolvers<WorkerStats>();
    const handle: WorkerHandle = {
      worker,
      index,
      stats: null,
      done,
      resolveDone,
      rejectDone,
      snapshotWaiters: [],
      progress: { roomsStarted: 0, intentsSent: 0 },
    };
    worker.on("message", (message: WorkerToMain) => {
      if (message.type === "progress") {
        handle.progress = {
          roomsStarted: message.roomsStarted,
          intentsSent: message.intentsSent,
        };
        return;
      }
      if (message.type === "snapshot") {
        handle.snapshotWaiters.shift()?.(message.stats);
        return;
      }
      handle.stats = message.stats;
      resolveDone(message.stats);
      for (const waiter of handle.snapshotWaiters.splice(0)) waiter(message.stats);
    });
    worker.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`worker ${index} error: ${message}`);
      rejectDone(error instanceof Error ? error : new Error(message));
    });
    worker.on("exit", (code) => {
      if (handle.stats === null) {
        rejectDone(new Error(`worker ${index} exited with ${code}`));
      }
    });
    const config: WorkerConfig = {
      endpoint: options.endpoint,
      runStartMs,
      stopAtMs,
      profile: options.profile,
      rooms: plans.filter((_plan, planIndex) => planIndex % count === index),
      watchers: watcherShare(options.profile.lobbyWatchers, index, count),
      password: "loadtest-password",
      workerIndex: index,
    };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port
    worker.postMessage({ type: "start", config } satisfies MainToWorker);
    return handle;
  });
}

function watcherShare(total: number, index: number, count: number): number {
  const before = Math.floor((total * index) / count);
  const after = Math.floor((total * (index + 1)) / count);
  return after - before;
}

function sendAll(handles: WorkerHandle[], message: MainToWorker): void {
  for (const handle of handles) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port
    handle.worker.postMessage(message);
  }
}

async function requestSnapshot(handle: WorkerHandle): Promise<WorkerStats> {
  const { promise, resolve } = Promise.withResolvers<WorkerStats>();
  handle.snapshotWaiters.push(resolve);
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port
  handle.worker.postMessage({ type: "snapshot" } satisfies MainToWorker);
  return withTimeout(promise, 15_000).catch(() => handle.stats ?? emptyWorkerStats());
}

async function stopWorkers(handles: WorkerHandle[]): Promise<WorkerStats[]> {
  sendAll(handles, { type: "stop" });
  const stats = await Promise.all(
    handles.map((handle) =>
      withTimeout(handle.done, 30_000)
        .catch(() => handle.stats ?? emptyWorkerStats())
        .finally(() => void handle.worker.terminate()),
    ),
  );
  return stats;
}

function printVerdict(result: Verdict): void {
  console.log("");
  for (const row of result.criteria) {
    const mark = row.status === "pass" ? "PASS" : row.status === "fail" ? "FAIL" : "SKIP";
    console.log(
      `${mark.padEnd(4)}  ${row.label.padEnd(46)} ${row.actual.padStart(12)}  (${row.threshold})`,
    );
  }
  if (!result.valid) console.log(`\nINVALID RUN: ${result.invalidReason}`);
  console.log(`\n${result.pass ? "PASS" : "FAIL"}\n`);
}

function startedRooms(plans: { startAtMs: number }[], runStartMs: number, atMs: number): number {
  return plans.filter((plan) => runStartMs + plan.startAtMs <= atMs).length;
}

function noRestart(): RestartMeasurements {
  return {
    readyzSeconds: null,
    restoreSeconds: null,
    roomsRestored: null,
    roomsLiveAtKill: null,
    clientsAtKill: null,
    clientsBackInTime: null,
    maxRejoinAfterReadyMs: null,
    serverStarts: null,
  };
}

function emptyServer(): ServerMetrics {
  return {
    intentP95Ms: null,
    intentP99Ms: null,
    storeWriteP99Ms: null,
    eventLoopP99Ms: null,
    serverCpuCores: null,
    serverRssBytes: null,
    heapGrowthRatio: null,
    rejections: {},
    roomsRestored: null,
    restoreSeconds: null,
    roomsPlayingAtKill: null,
    serverStarts: null,
  };
}

function hostInfo(): RunReport["host"] {
  return {
    cpuModel: cpus()[0]?.model.trim() ?? "unknown CPU",
    cpuCount: availableParallelism(),
    platform: `${platform()} ${process.arch} ${release()}`,
    node: process.version,
    totalMemoryBytes: totalmem(),
  };
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

async function waitForPrometheus(baseUrl: string, timeoutMs: number): Promise<void> {
  const { ok } = await pollUntil(async () => (await fetch(`${baseUrl}/-/ready`)).ok, {
    timeoutMs,
    intervalMs: 250,
  });
  if (!ok) throw new Error(`Prometheus did not become ready within ${timeoutMs / 1_000} s`);
}

function log(line: string): void {
  const now = new Date();
  const stamp = now.toTimeString().slice(0, 8);
  console.log(`[loadtest ${stamp}] ${line}`);
}

function minutes(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.round(seconds / 60)}m`;
}

function slower(line: string, measured: number, limit: number): string {
  return `${line}${measured > limit ? ` (over the ${limit} s limit)` : ""}`;
}

function isDefaultProfile(profile: LoadProfile): boolean {
  return (
    profile.rooms === DEFAULT_PROFILE.rooms &&
    profile.rampSeconds === DEFAULT_PROFILE.rampSeconds &&
    profile.holdSeconds === DEFAULT_PROFILE.holdSeconds &&
    profile.restartAfterHoldSeconds === DEFAULT_PROFILE.restartAfterHoldSeconds &&
    profile.playersPerRoom === DEFAULT_PROFILE.playersPerRoom
  );
}
