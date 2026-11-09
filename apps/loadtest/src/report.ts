/**
 * The run's Markdown report (spec: Load test): the git SHA, the host, the
 * generator's CPU peak and every number the verdict read, so a passing run
 * can be committed under docs/loadtest/ as sign-off evidence.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KneeProfile, LoadProfile } from "#config.ts";
import type { PromWindows, ServerMetrics } from "#metrics.ts";
import type { ClientSummary } from "#stats.ts";
import {
  bytesShort,
  cores,
  count,
  gib,
  ms,
  ratio,
  seconds,
  type Criterion,
  type RestartMeasurements,
  type Verdict,
} from "#verdict.ts";

export type KneeResult = {
  /** The last whole-minute count that passed; 0 when the first sample failed. */
  lastPassingRooms: number;
  startedRooms: number;
  breakingCriterion: string | null;
  samples: number;
};

export type RunReport = {
  mode: "full" | "scaled" | "knee";
  startedAt: Date;
  /** Full `git rev-parse HEAD`. */
  gitSha: string;
  host: {
    cpuModel: string;
    cpuCount: number;
    platform: string;
    node: string;
    totalMemoryBytes: number;
  };
  options: {
    endpoint: string;
    httpPort: number;
    prometheusPort: number;
    projectName: string;
  };
  profile: LoadProfile;
  knee: KneeProfile | null;
  windows: PromWindows | null;
  server: ServerMetrics;
  client: ClientSummary;
  restart: RestartMeasurements;
  verdict: Verdict;
  durationSeconds: number;
  warnings: string[];
  /** Set in `--find-knee` mode. */
  kneeResult?: KneeResult | null;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

/** `loadtest-20261020-180509.md` in UTC. */
export function reportFileName(startedAt: Date): string {
  return `loadtest-${startedAt.getUTCFullYear()}${pad2(startedAt.getUTCMonth() + 1)}${pad2(
    startedAt.getUTCDate(),
  )}-${pad2(startedAt.getUTCHours())}${pad2(startedAt.getUTCMinutes())}${pad2(
    startedAt.getUTCSeconds(),
  )}.md`;
}

/** Writes the report into `reportDir` (gitignored) and returns its path. */
export function writeReport(reportDir: string, report: RunReport): string {
  mkdirSync(reportDir, { recursive: true });
  const path = join(reportDir, reportFileName(report.startedAt));
  writeFileSync(path, renderReport(report));
  return path;
}

const iso = (date: Date) => date.toISOString().replace("T", " ").replace(".000Z", " UTC");

const shortDuration = (seconds: number) =>
  seconds >= 60 && seconds % 60 === 0
    ? `${seconds / 60}m`
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;

const cell = (value: string) => value.replaceAll("|", "\\|");

const statusTitle = (report: RunReport) =>
  !report.verdict.valid ? "INVALID" : report.verdict.pass ? "PASS" : "FAIL";

const resultOf = (criterion: Criterion) =>
  criterion.status === "pass" ? "PASS" : criterion.status === "fail" ? "FAIL" : "SKIP";

export function renderReport(report: RunReport): string {
  const { profile } = report;
  const mode =
    report.mode === "knee" ? "find-knee" : report.mode === "scaled" ? "scaled run" : "full run";
  const lines: string[] = [
    `# UNIversum load test — ${statusTitle(report)}`,
    "",
    `- Started: ${iso(report.startedAt)}`,
    `- Mode: ${mode}`,
    `- Duration: ${shortDuration(Math.round(report.durationSeconds))}`,
    `- Git SHA: \`${report.gitSha}\``,
    `- Host: ${report.host.cpuModel} (${report.host.cpuCount} cores), ${report.host.platform}, ${gib(
      report.host.totalMemoryBytes,
    )} RAM, Node ${report.host.node}`,
    `- Endpoint: ${report.options.endpoint}`,
    `- Compose project: \`${report.options.projectName}\``,
    `- Generator CPU peak: ${ratio(report.client.generatorCpuPeakFraction)} of the machine — ${
      report.verdict.valid ? "VALID" : "INVALID"
    }`,
    "",
  ];

  if (report.warnings.length > 0) {
    lines.push("Warnings:", ...report.warnings.map((warning) => `- ${warning}`), "");
  }

  lines.push(
    "## Profile",
    "",
    `- ${profile.rooms} Rooms × ${profile.playersPerRoom} Guests; ${shortDuration(
      profile.rampSeconds,
    )} ramp; ${shortDuration(profile.holdSeconds)} hold; kill at ${shortDuration(
      profile.restartAfterHoldSeconds,
    )} of the hold; ${shortDuration(profile.restartExclusionSeconds)} excluded after the restart`,
    `- ${profile.minuteLimit}-minute Minute limit; ${ratio(profile.passwordRoomRate)} password Rooms; ${profile.lobbyWatchers} Lobby watchers; joins over ${shortDuration(
      Math.round(profile.joinDelayMs[0] / 1_000),
    )}–${shortDuration(Math.round(profile.joinDelayMs[1] / 1_000))}`,
    `- Actions after ${shortDuration(Math.round(profile.actionDelayMs[0] / 1_000))}–${shortDuration(
      Math.round(profile.actionDelayMs[1] / 1_000),
    )}; ${ratio(profile.timeoutRate)} Turn timeouts; ${ratio(profile.dropRate)} drops per game (${ratio(
      profile.longReturnRate,
    )} long, > 60 s by Guest token)`,
    `- Seed: ${profile.seed}`,
    "",
    "## Verdict",
    "",
    "| Criterion | Threshold | Measured | Result |",
    "| --- | --- | --- | --- |",
    ...report.verdict.criteria.map(
      (row) =>
        `| ${cell(row.label)} | ${cell(row.threshold)} | ${cell(row.actual)} | ${resultOf(row)} |`,
    ),
    "",
  );

  if (!report.verdict.valid && report.verdict.invalidReason !== null) {
    lines.push(`**Invalid run:** ${report.verdict.invalidReason}`, "");
  }

  lines.push(
    "## Server metrics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Intent duration p95 | ${orNoData(report.server.intentP95Ms, ms)} |`,
    `| Intent duration p99 | ${orNoData(report.server.intentP99Ms, ms)} |`,
    `| Store write p99 | ${orNoData(report.server.storeWriteP99Ms, ms)} |`,
    `| Event-loop lag p99 | ${orNoData(report.server.eventLoopP99Ms, ms)} |`,
    `| Server CPU | ${orNoData(report.server.serverCpuCores, cores)} |`,
    `| Server RSS | ${orNoData(report.server.serverRssBytes, gib)} |`,
    `| Heap growth | ${orNoData(report.server.heapGrowthRatio, ratio)} |`,
    `| Rooms restored | ${orNoData(report.server.roomsRestored, count)} |`,
    `| Restore time | ${orNoData(report.server.restoreSeconds, seconds)} |`,
    `| Rooms playing at the kill | ${orNoData(report.server.roomsPlayingAtKill, count)} |`,
    `| Server process starts | ${orNoData(report.server.serverStarts, count)} |`,
    ...Object.entries(report.server.rejections).map(
      ([code, value]) => `| ${code} rejections | ${count(value)} |`,
    ),
    "",
    "## Restart",
    "",
    "| Check | Value |",
    "| --- | --- |",
    `| /readyz after the kill | ${orNoData(report.restart.readyzSeconds, seconds)} |`,
    `| Restore time at boot | ${orNoData(report.restart.restoreSeconds, seconds)} |`,
    `| Rooms restored | ${orNoData(report.restart.roomsRestored, count)} |`,
    `| Rooms live at the kill | ${orNoData(report.restart.roomsLiveAtKill, count)} |`,
    `| Clients at the kill | ${orNoData(report.restart.clientsAtKill, count)} |`,
    `| Clients back in time | ${orNoData(report.restart.clientsBackInTime, count)} |`,
    `| Slowest Seat back after /readyz | ${orNoData(report.restart.maxRejoinAfterReadyMs, ms)} |`,
    "",
    "## Client generator",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Room round trips | ${report.client.rttSamples} samples |`,
    `| Room round trip p95 | ${orNoData(report.client.rttP95Ms, ms)} |`,
    `| Room round trip p99 | ${orNoData(report.client.rttP99Ms, ms)} |`,
    `| Room round trip max | ${orNoData(report.client.maxRttMs, ms)} |`,
    `| Game push size | ${report.client.pushSamples} samples |`,
    `| Game push size p50 | ${orNoData(report.client.pushP50Bytes, bytesShort)} |`,
    `| Game push size p95 | ${orNoData(report.client.pushP95Bytes, bytesShort)} |`,
    `| Game push size max | ${orNoData(report.client.maxPushBytes, bytesShort)} |`,
    `| Intents sent / accepted | ${count(report.client.intentsSent)} / ${count(
      report.client.intentsAccepted,
    )} |`,
    `| Client rejections | ${rejectionList(report.client.rejections)} |`,
    `| Decisions / Turn timeouts | ${count(report.client.decisions)} / ${count(
      report.client.timeouts,
    )} |`,
    `| Drops (short / long) | ${count(report.client.drops)} (${count(
      report.client.shortDrops,
    )} / ${count(report.client.longDrops)}) |`,
    `| Rejoins (token / Guest) | ${count(report.client.tokenRejoins)} / ${count(
      report.client.guestRejoins,
    )} |`,
    `| Failed rejoins | ${count(report.client.failedRejoins)} |`,
    `| Seat mismatches | ${count(report.client.seatMismatches)} |`,
    `| Version regressions | ${count(report.client.versionRegressions)} |`,
    `| Unplanned exits | ${count(report.client.unplannedExits)} |`,
    `| Rooms started | ${count(report.client.roomsStarted)} |`,
    `| Games finished | ${count(report.client.gamesFinished)} |`,
    `| Generator CPU peak | ${ratio(report.client.generatorCpuPeakFraction)} |`,
    "",
    "Game push size is the UTF-8 byte length of each `game` push the bot received, re-encoded from the decoded message as JSON (the wire itself is msgpack). Reported only; no verdict threshold.",
    "",
  );

  if (report.client.errors.length > 0) {
    lines.push("Generator errors:", ...report.client.errors.map((error) => `- ${error}`), "");
  }

  if (report.kneeResult) {
    lines.push(
      "## find-knee",
      "",
      `- Last passing count: ${report.kneeResult.lastPassingRooms} Rooms`,
      `- Started ${report.kneeResult.startedRooms} Rooms over ${report.kneeResult.samples} one-minute samples`,
      `- Broke at: ${report.kneeResult.breakingCriterion ?? "no threshold broke"}`,
      "",
    );
  }

  if (report.windows) {
    lines.push(
      "## Measured windows",
      "",
      `- Run start: ${iso(new Date(report.windows.runStartMs))}`,
      `- Hold start: ${iso(new Date(report.windows.holdStartMs))}`,
      `- Kill: ${iso(new Date(report.windows.killMs))}`,
      `- Hold end: ${iso(new Date(report.windows.holdEndMs))}`,
      `- Second window: ${
        report.windows.b === null
          ? "none (the restart left less than the exclusion)"
          : shortDuration(report.windows.b.seconds)
      }`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

function orNoData(value: number | null, format: (value: number) => string): string {
  return value === null ? "no data" : format(value);
}

function rejectionList(rejections: Record<string, number>): string {
  const entries = Object.entries(rejections).filter(([, value]) => value > 0);
  return entries.length === 0
    ? "none"
    : entries.map(([code, value]) => `${code} ${count(value)}`).join(", ");
}
