/**
 * The weekly report's body: the numbers, the budget warning and the owner's
 * queue. Pure — `report.ts` fetches, posts and edits.
 */
import type { NeedsYouItem, ReportMetrics } from "#report/metrics.ts";
import { budgetWarning } from "#report/metrics.ts";
import { reportMarker } from "#report/issue.ts";
import type { WeekWindow } from "#report/week.ts";

export interface ReportInput {
  readonly week: WeekWindow;
  readonly metrics: ReportMetrics;
  readonly needsYou: readonly NeedsYouItem[];
}

const oneDecimal = (value: number): string => String(Math.round(value * 10) / 10);

/** Hours under two days, days above; `none yet` when the week brought no pair. */
const formatDuration = (hours: number | null): string =>
  hours === null
    ? "none yet"
    : hours >= 48
      ? `${oneDecimal(hours / 24)} days`
      : `${oneDecimal(hours)} hours`;

const formatRounds = (mean: number | null): string =>
  mean === null ? "none yet" : oneDecimal(mean);

const formatMerges = (metrics: ReportMetrics): string =>
  metrics.autoMerged + metrics.humanMerged === 0
    ? "none yet"
    : `${String(metrics.autoMerged)} auto / ${String(metrics.humanMerged)} human`;

const formatClaude = (metrics: ReportMetrics): string =>
  metrics.claudeNight + metrics.claudeDay === 0
    ? "none yet"
    : `${String(metrics.claudeNight)} night, ${String(metrics.claudeDay)} day`;

const formatLines = (lines: number | null): string =>
  lines === null ? "none yet" : `${String(lines)} line${lines === 1 ? "" : "s"}`;

const formatNeedsYou = (items: readonly NeedsYouItem[]): string =>
  items.length === 0
    ? "Nothing is waiting for you."
    : items
        .map(
          (item) =>
            `- [#${String(item.number)} ${item.title}](${item.url}) — ${item.labels.join(", ")}, since ${item.createdAt.slice(0, 10)}`,
        )
        .join("\n");

export const reportBody = ({ week, metrics, needsYou }: ReportInput): string => {
  const warning = budgetWarning(metrics.minutes.month, metrics.minutes.limit);
  return [
    reportMarker(week.weekOf),
    `# Factory report: week of ${week.weekOf}`,
    "",
    `Monday ${week.weekOf} 00:00 to Monday ${week.endOf} 00:00, Europe/Budapest.`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Tickets merged | ${String(metrics.ticketsMerged)} |`,
    `| Blocked | ${String(metrics.blocked)} |`,
    `| Fix rounds (mean) | ${formatRounds(metrics.meanFixRounds)} |`,
    `| Merges | ${formatMerges(metrics)} |`,
    `| Idea → merge (median) | ${formatDuration(metrics.medianIdeaToMergeHours)} |`,
    `| Minutes | ${String(metrics.minutes.month)} of ${String(metrics.minutes.limit)} this month; ${String(metrics.minutes.week)} this week |`,
    `| Claude runs | ${formatClaude(metrics)} |`,
    `| omp runs | ${metrics.ompRuns === 0 ? "none yet" : String(metrics.ompRuns)} |`,
    `| Retro changes | ${formatLines(metrics.retroLines)} |`,
    ...(warning === null ? [] : ["", `**Budget:** ${warning}`]),
    "",
    "## Needs you",
    "",
    formatNeedsYou(needsYou),
    "",
  ].join("\n");
};
