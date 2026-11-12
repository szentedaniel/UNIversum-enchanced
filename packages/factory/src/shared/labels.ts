/**
 * The labels the dispatcher and the architecture pass share: what makes an
 * issue a ticket rather than a spec or a report, and the label the dispatcher
 * starts one on. Both intakes read the same set, so a ticket the dispatcher
 * starts is a ticket the proposal dedupe treats as in flight.
 */

/** The labels that make an issue a ticket, not a spec or a report. */
export const WORK_LABELS: ReadonlySet<string> = new Set([
  "ready-for-agent",
  "agent:in-progress",
  "agent:blocked",
  "ready-for-human",
]);

/** The label the dispatcher starts a ticket on. */
export const READY_LABEL = "ready-for-agent";

/** Whether the issue is ticket-shaped: a work label, and no sub-issues making it a spec. */
export const isTicketWork = (issue: {
  readonly labels: readonly string[];
  readonly subIssues: number;
}): boolean => issue.subIssues === 0 && issue.labels.some((label) => WORK_LABELS.has(label));
