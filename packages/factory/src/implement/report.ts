/** Sandcastle's default completion signal, which the agent ends its turn with. */
const COMPLETION_SIGNAL = /(<promise>COMPLETE<\/promise>)\s*$/u;

/**
 * `docs/agents/implementer.md`'s report, read from the run's output. The
 * protocol's report starts with `STATUS: DONE | BLOCKED`, so everything from
 * the last such line on is the report; the agent's narration stays behind.
 * Without a report the whole output is the body, so a failed run still says
 * something in its PR body.
 */
export const reportFrom = (stdout: string): string => {
  const lines = stdout.split("\n");
  const start = lines.findLastIndex((line) => line.startsWith("STATUS: "));
  const report = start === -1 ? stdout : lines.slice(start).join("\n");
  return report.trimEnd().replace(COMPLETION_SIGNAL, "").trim();
};

/** The report's verdict: the run finished its ticket, or it stopped to ask. */
export type ReportStatus = "DONE" | "BLOCKED";

const STATUS_LINE = /^STATUS: (DONE|BLOCKED)\b/u;

/**
 * The status line a (report-shaped) report opens with: `reportFrom` cuts the
 * report at a `STATUS: ` line, so the first line decides. Anything else reads
 * as done — an unreadable report still goes to review rather than hiding the
 * work behind a blocked label.
 */
export const reportStatus = (report: string): ReportStatus => {
  const [first = ""] = report.split("\n");
  return STATUS_LINE.exec(first)?.[1] === "BLOCKED" ? "BLOCKED" : "DONE";
};
