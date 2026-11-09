/**
 * The weekly report's issue: its title, the hidden marker that makes a re-run
 * an edit, and the plan for last week's issue. Pure — the script lists the
 * open report issues and carries the plan out.
 */

/** The label every weekly (and the dispatcher's monthly) report carries. */
export const REPORT_LABEL = "factory:report";

/** How every weekly report's title opens; the dispatcher's month issue does not. */
export const WEEKLY_TITLE_PREFIX = "Factory report: week of ";

/** The open report issue the script may edit or close. */
export interface ReportIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
}

export type ReportPlan =
  | { readonly action: "create"; readonly closes: readonly number[] }
  | {
      readonly action: "edit";
      readonly number: number;
      /** Older weekly reports to close once this week's is written. */
      readonly closes: readonly number[];
    };

export const reportMarker = (weekOf: string): string => `<!-- factory-report:${weekOf} -->`;

export const reportTitle = (weekOf: string): string => `${WEEKLY_TITLE_PREFIX}${weekOf}`;

/**
 * This week's issue found by its marker (a drifted title still counts, an edit
 * is cheaper than a duplicate); if there is none, it gets opened. The older
 * weekly issues are closed afterwards, never before: the dispatcher comments
 * its budget notice on the newest open report issue. A `Factory report —
 * YYYY-MM` issue has a month in its title, not a week, so it stays open.
 */
export const reportPlan = (issues: readonly ReportIssue[], weekOf: string): ReportPlan => {
  const marker = reportMarker(weekOf);
  const current = issues.find((issue) => (issue.body ?? "").includes(marker));
  const closes = issues
    .filter(
      (issue) => issue.number !== current?.number && issue.title.startsWith(WEEKLY_TITLE_PREFIX),
    )
    .map((issue) => issue.number);
  return current === undefined
    ? { action: "create", closes }
    : { action: "edit", number: current.number, closes };
};
