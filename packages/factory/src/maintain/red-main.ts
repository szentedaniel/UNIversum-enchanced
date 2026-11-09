/**
 * Red main: a CI run on `main` failed, so the next thing the factory does is
 * fix main. The issue is the dispatcher's, `priority:top` and `ready-for-agent`,
 * and it is deduped by this marker: while one is open, a second red run
 * comments on it instead of opening another.
 */

/** The hidden marker the open red-main issue carries. */
export const RED_MAIN_MARKER = "<!-- factory:red-main -->";

/** What the watch knows about the failed run. */
export interface RedMain {
  /** The commit main is red on. */
  readonly commit: string;
  readonly runUrl: string;
  /** The failed jobs, in the run's order. */
  readonly jobs: readonly string[];
  /** The failed jobs' log tail (`excerptOf`). */
  readonly excerpt: string;
}

const shortCommit = (commit: string): string => commit.slice(0, 7);

export const redMainTitle = (run: RedMain): string =>
  `Red main: CI failed on ${shortCommit(run.commit)}`;

/**
 * The issue's body: the marker, the commit and run, the jobs, and the log
 * tail. The excerpt is fenced with four backticks so a log that prints a
 * three-backtick fence of its own still renders.
 */
export const redMainBody = (run: RedMain): string =>
  [
    RED_MAIN_MARKER,
    "## Red main",
    "",
    `CI failed on \`main\` at \`${shortCommit(run.commit)}\` ([run](${run.runUrl})).`,
    "",
    `**Failed jobs:** ${run.jobs.length === 0 ? "(none reported)" : run.jobs.join(", ")}`,
    "",
    "````text",
    run.excerpt,
    "````",
    "",
  ].join("\n");

/** The open issue already carrying the marker, if one is open. */
export const redMainIssue = (
  issues: readonly { readonly number: number; readonly body: string | null }[],
): number | undefined =>
  issues.find((issue) => (issue.body ?? "").includes(RED_MAIN_MARKER))?.number;
