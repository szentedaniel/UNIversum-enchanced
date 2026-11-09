/**
 * The weekly report's numbers: a pure reading of the week's pull requests,
 * runs and budget, so the script only fetches and posts. A week with nothing
 * in it reads as zeros and `null`s ("none yet"), never a crash — a factory
 * step that does not exist yet must not stop the report.
 */
import { isNightWindow } from "#review/window.ts";

/** An issue a merged pull request closes, with what idea-to-merge time needs. */
export interface ClosingIssueFacts {
  readonly number: number;
  readonly createdAt: string;
}

/**
 * A merged pull request that closes an issue — a factory ticket pull request.
 * One that closes none (Dependabot, the owner's maintenance) is not counted:
 * it has no idea-to-merge time and no merge marker to read.
 */
export interface MergedPullFacts {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly mergedAt: string;
  readonly closes: readonly ClosingIssueFacts[];
  /** The highest `<!-- factory-fix:round N -->` the pull request carries. */
  readonly fixRounds: number;
  /** #87's `<!-- factory-merge -->` marker on the closing issue. */
  readonly auto: boolean;
}

/** A workflow run, as the night/day split reads it. */
export interface RunFacts {
  readonly createdAt: string;
  readonly startedAt: string | null;
}

/** An open issue or pull request waiting for the owner. */
export interface NeedsYouItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string;
  readonly labels: readonly string[];
}

export interface MinutesFacts {
  /** Billed factory minutes since the first of the month, UTC. */
  readonly month: number;
  /** Billed factory minutes of the reported week. */
  readonly week: number;
  readonly limit: number;
}

export interface ReportFacts {
  readonly mergedPulls: readonly MergedPullFacts[];
  /** Numbers of the open `agent:blocked` issues. */
  readonly blockedOpen: readonly number[];
  /** Numbers of the issues that got `agent:blocked` in the week. */
  readonly blockedThisWeek: readonly number[];
  /** Runs of `CLAUDE_WORKFLOWS` started in the week. */
  readonly claudeRuns: readonly RunFacts[];
  /** Runs of `OMP_WORKFLOWS` started in the week. */
  readonly ompRuns: readonly RunFacts[];
  readonly minutes: MinutesFacts;
  /** Lines added to `docs/agents/factory-log.md`; `null` when it does not exist. */
  readonly retroLines: number | null;
}

export interface ReportMetrics {
  readonly ticketsMerged: number;
  readonly blocked: number;
  readonly meanFixRounds: number | null;
  readonly autoMerged: number;
  readonly humanMerged: number;
  readonly medianIdeaToMergeHours: number | null;
  readonly minutes: MinutesFacts;
  readonly claudeNight: number;
  readonly claudeDay: number;
  readonly ompRuns: number;
  readonly retroLines: number | null;
}

/** The labels that make an issue or pull request the owner's queue. */
export const NEEDS_YOU_LABELS: readonly string[] = ["ready-for-human", "spec:proposed"];

/** #87's marker on the closing issue when the merge gate merged the pull request. */
export const AUTO_MERGE_MARKER = "<!-- factory-merge -->";

/** The share of `FACTORY_MONTHLY_MINUTES` at which the report warns. */
export const BUDGET_WARN_PERCENT = 80;

const FIX_ROUND = /<!--\s*factory-fix:round\s+(\d+)\s*-->/gu;

/** The furthest round any of `bodies` reports; 0 when no fix loop touched it. */
export const fixRoundsOf = (bodies: readonly string[]): number => {
  let highest = 0;
  for (const body of bodies) {
    for (const match of body.matchAll(FIX_ROUND)) {
      const round = Number(match[1]);
      if (Number.isInteger(round) && round > highest) highest = round;
    }
  }
  return highest;
};

/** Added lines of `git log --numstat` output; binary entries (`-`) add none. */
export const linesAdded = (numstat: string): number =>
  numstat.split("\n").reduce((total, line) => {
    const added = Number(line.split("\t")[0] ?? "");
    return Number.isInteger(added) ? total + added : total;
  }, 0);

/**
 * The one warning the report carries, or `null` below 80 percent. Integer
 * arithmetic keeps the boundary exact (`1120 of 1400` is 80 percent).
 */
export const budgetWarning = (month: number, limit: number): string | null => {
  if (limit <= 0) return null;
  if (month >= limit) {
    return `The monthly budget is spent (${String(month)} of ${String(limit)} minutes); the dispatcher is idle until next month.`;
  }
  if (month * 100 >= limit * BUDGET_WARN_PERCENT) {
    const percent = Math.floor((month * 100) / limit);
    return `The monthly budget is ${String(percent)}% spent (${String(month)} of ${String(limit)} minutes).`;
  }
  return null;
};

/** The owner's queue: the two labels, one entry per number, oldest first. */
export const needsYouOf = (items: readonly NeedsYouItem[]): NeedsYouItem[] => {
  const seen = new Set<number>();
  return items
    .flatMap((item) => {
      const labels = item.labels.filter((label) => NEEDS_YOU_LABELS.includes(label));
      if (labels.length === 0 || seen.has(item.number)) return [];
      seen.add(item.number);
      return [{ ...item, labels }];
    })
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number);
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].toSorted((a, b) => a - b);
  if (sorted.length % 2 === 1) return sorted[(sorted.length - 1) / 2] ?? null;
  const low = sorted[sorted.length / 2 - 1] ?? 0;
  const high = sorted[sorted.length / 2] ?? 0;
  return (low + high) / 2;
};

/** Hours from `from` to `to`; a missing or backwards pair contributes nothing. */
const hoursBetween = (from: string, to: string): number | null => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? (end - start) / 3_600_000
    : null;
};

export const reportMetrics = (facts: ReportFacts): ReportMetrics => {
  const closingIssues = facts.mergedPulls.flatMap((pull) =>
    pull.closes.map((issue) => issue.number),
  );
  const ideaToMerge = facts.mergedPulls.flatMap((pull) =>
    pull.closes.flatMap((issue) => {
      const hours = hoursBetween(issue.createdAt, pull.mergedAt);
      return hours === null ? [] : [hours];
    }),
  );
  const fixRounds = facts.mergedPulls.map((pull) => pull.fixRounds);
  const autoMerged = facts.mergedPulls.filter((pull) => pull.auto).length;
  const claudeNight = facts.claudeRuns.filter((run) =>
    isNightWindow(new Date(run.startedAt ?? run.createdAt)),
  ).length;

  return {
    ticketsMerged: new Set(closingIssues).size,
    blocked: new Set([...facts.blockedOpen, ...facts.blockedThisWeek]).size,
    meanFixRounds:
      fixRounds.length === 0
        ? null
        : fixRounds.reduce((total, rounds) => total + rounds, 0) / fixRounds.length,
    autoMerged,
    humanMerged: facts.mergedPulls.length - autoMerged,
    medianIdeaToMergeHours: median(ideaToMerge),
    minutes: facts.minutes,
    claudeNight,
    claudeDay: facts.claudeRuns.length - claudeNight,
    ompRuns: facts.ompRuns.length,
    retroLines: facts.retroLines,
  };
};
