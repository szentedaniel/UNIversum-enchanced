/**
 * The run's verdict (spec: Load test). Every criterion is a row with the
 * threshold, the measured number and PASS/FAIL; a measurement with no data is
 * skipped rather than failed. A generator that used more than 70% of the
 * machine makes the whole run invalid.
 */
import type { LoadThresholds } from "#config.ts";
import type { ServerMetrics } from "#metrics.ts";
import type { ClientSummary } from "#stats.ts";

export type RestartMeasurements = {
  /** From the SIGKILL to `/readyz` answering 200. */
  readyzSeconds: number | null;
  /** The `restore_duration_seconds` the server set at that boot. */
  restoreSeconds: number | null;
  roomsRestored: number | null;
  /** The generator's count of Rooms playing at the kill. */
  roomsLiveAtKill: number | null;
  /** Clients that were in a Room at the kill, and how many were back within the window. */
  clientsAtKill: number | null;
  clientsBackInTime: number | null;
  maxRejoinAfterReadyMs: number | null;
  /** Distinct server process start times over the run (2 = only the planned restart). */
  serverStarts: number | null;
};

export type VerdictInput = {
  thresholds: LoadThresholds;
  server: ServerMetrics;
  client: ClientSummary;
  restart: RestartMeasurements;
};

export type CriterionStatus = "pass" | "fail" | "skip";

export type Criterion = {
  id: string;
  /** What is being checked, in words. */
  label: string;
  /** The threshold, already formatted (e.g. "≤ 50 ms"). */
  threshold: string;
  /** The measured value, already formatted (or "no data"). */
  actual: string;
  /** The raw measured value; `null` when there was no data. */
  measured: number | null;
  status: CriterionStatus;
};

export type Verdict = {
  criteria: Criterion[];
  /** False when the run itself is invalid (generator CPU over 70%). */
  valid: boolean;
  /** True only for a valid run with no failing criterion. */
  pass: boolean;
  invalidReason: string | null;
};

const ms = (value: number) => `${value.toFixed(1)} ms`;
const seconds = (value: number) => `${value.toFixed(1)} s`;
const bytes = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GB`;
const ratio = (value: number) => `${(value * 100).toFixed(1)}%`;
const cores = (value: number) => `${value.toFixed(2)} cores`;
const count = (value: number) => String(Math.round(value));

type CriterionSpec = {
  id: string;
  label: string;
  measured: number | null;
  limit: number;
  format: (value: number) => string;
};

function criterion(spec: CriterionSpec): Criterion {
  const { id, label, measured, limit, format } = spec;
  return {
    id,
    label,
    threshold: `≤ ${format(limit)}`,
    actual: measured === null ? "no data" : format(measured),
    measured,
    status: measured === null ? "skip" : measured <= limit ? "pass" : "fail",
  };
}

export function verdict(input: VerdictInput): Verdict {
  const { thresholds, server, client, restart } = input;
  const criteria: Criterion[] = [
    criterion({
      id: "intent-p95",
      label: "intent duration p95",
      measured: server.intentP95Ms,
      limit: thresholds.intentP95Ms,
      format: ms,
    }),
    criterion({
      id: "intent-p99",
      label: "intent duration p99",
      measured: server.intentP99Ms,
      limit: thresholds.intentP99Ms,
      format: ms,
    }),
    criterion({
      id: "store-write-p99",
      label: "RoomStore write p99",
      measured: server.storeWriteP99Ms,
      limit: thresholds.storeWriteP99Ms,
      format: ms,
    }),
    criterion({
      id: "event-loop-p99",
      label: "event-loop lag p99",
      measured: server.eventLoopP99Ms,
      limit: thresholds.eventLoopP99Ms,
      format: ms,
    }),
    criterion({
      id: "client-rtt-p95",
      label: "client round trip p95",
      measured: client.rttP95Ms,
      limit: thresholds.clientRttP95Ms,
      format: ms,
    }),
    criterion({
      id: "client-rtt-p99",
      label: "client round trip p99",
      measured: client.rttP99Ms,
      limit: thresholds.clientRttP99Ms,
      format: ms,
    }),
    criterion({
      id: "server-cpu",
      label: "server CPU (average)",
      measured: server.serverCpuCores,
      limit: thresholds.serverCpuCores,
      format: cores,
    }),
    criterion({
      id: "server-rss",
      label: "server RSS (peak)",
      measured: server.serverRssBytes,
      limit: thresholds.serverRssBytes,
      format: bytes,
    }),
    criterion({
      id: "heap-growth",
      label: "heap growth (last 15 min)",
      measured: server.heapGrowthRatio,
      limit: thresholds.heapGrowthRatio,
      format: ratio,
    }),
    ...Object.entries(thresholds.rejections).map(([code, limit]) =>
      criterion({
        id: `rejections-${code}`,
        label: `${code} rejections`,
        measured: server.rejections[code] ?? 0,
        limit,
        format: count,
      }),
    ),
    criterion({
      id: "unplanned-exits",
      label: "unplanned exits (sockets + server processes)",
      measured:
        restart.serverStarts === null
          ? client.unplannedExits
          : client.unplannedExits + Math.max(0, restart.serverStarts - 2),
      limit: thresholds.unplannedExits,
      format: count,
    }),
    criterion({
      id: "lost-rooms",
      label: "Rooms lost at the restart",
      measured:
        restart.roomsLiveAtKill === null || restart.roomsRestored === null
          ? null
          : Math.max(0, restart.roomsLiveAtKill - restart.roomsRestored),
      limit: thresholds.lostRooms,
      format: count,
    }),
    criterion({
      id: "failed-rejoins",
      label: "dropped clients without their Seat back",
      measured: client.failedRejoins,
      limit: thresholds.failedRejoins,
      format: count,
    }),
    criterion({
      id: "seat-mismatches",
      label: "rejoins into a different Seat",
      measured: client.seatMismatches,
      limit: thresholds.seatMismatches,
      format: count,
    }),
    criterion({
      id: "version-regressions",
      label: "clients shown an older state version",
      measured: client.versionRegressions,
      limit: thresholds.versionRegressions,
      format: count,
    }),
    criterion({
      id: "readyz",
      label: "/readyz after the kill",
      measured: restart.readyzSeconds,
      limit: thresholds.readyzSeconds,
      format: seconds,
    }),
    criterion({
      id: "restore",
      label: "restore time at boot",
      measured: restart.restoreSeconds,
      limit: thresholds.restoreSeconds,
      format: seconds,
    }),
    criterion({
      id: "reseated",
      label: "clients back in their Seat after /readyz",
      measured: reseatOverrun(restart, thresholds),
      limit: 0,
      format: count,
    }),
    criterion({
      id: "generator-cpu",
      label: "generator CPU peak (run validity)",
      measured: client.generatorCpuPeakFraction,
      limit: thresholds.generatorCpuFraction,
      format: ratio,
    }),
  ];

  const valid = client.generatorCpuPeakFraction <= thresholds.generatorCpuFraction;
  const failed = criteria.some((row) => row.status === "fail");
  return {
    criteria,
    valid,
    pass: valid && !failed,
    invalidReason: valid
      ? null
      : `generator CPU peaked at ${ratio(client.generatorCpuPeakFraction)}, above the ${ratio(thresholds.generatorCpuFraction)} limit`,
  };
}

/** How many clients missed the reseat window. */
function reseatOverrun(restart: RestartMeasurements, thresholds: LoadThresholds): number | null {
  if (restart.clientsAtKill === null || restart.clientsBackInTime === null) return null;
  const late = Math.max(0, restart.clientsAtKill - restart.clientsBackInTime);
  const tooSlow =
    restart.maxRejoinAfterReadyMs !== null &&
    restart.maxRejoinAfterReadyMs > thresholds.reseatSeconds * 1_000;
  return late + (tooSlow ? 1 : 0);
}
