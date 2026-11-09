/**
 * The flaky-test pass reads Playwright's own summary out of the CI logs: the
 * list reporter prints a `N flaky` block, one `[project] › file:line:col ›
 * title` line per test that passed only on a retry. `failOnFlakyTests` makes
 * that a red run, so the block is where a flaky test surfaces.
 */

/** One test Playwright had to retry, as the summary prints it. */
export interface FlakyTest {
  readonly project: string;
  readonly file: string;
  /** Where the test was when the run happened; it moves with the file. */
  readonly line: number;
  readonly column: number;
  /** The test's title path: `describe › … › test`. */
  readonly title: string;
}

/** GitHub prefixes every `gh run view --log` line with job, step and time. */
const LOG_PREFIX = /^\S+\t[^\t\n]*\t\d{4}-\d{2}-\d{2}T[\d:.]+Z /u;

/** The colours Playwright writes when the terminal reports support. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/gu;

const FLAKY_COUNT = /^\s*\d+ flaky$/u;

/** `[project] › file:line:col › title`, after the separator is cut off. */
const ENTRY = /^\s*\[([^\]]+)\] › (\S+):(\d+):(\d+) › (.+)$/u;

/** The ` ────` the list reporter pads an entry with. */
const SEPARATOR = / ─+$/u;

const contentOf = (line: string): string =>
  line.replace(LOG_PREFIX, "").replace(ANSI, "").trimEnd();

const entryOf = (line: string): FlakyTest | undefined => {
  const match = ENTRY.exec(line.replace(SEPARATOR, ""));
  const project = match?.[1];
  const file = match?.[2];
  const lineNumber = match?.[3];
  const column = match?.[4];
  const title = match?.[5];
  if (
    project === undefined ||
    file === undefined ||
    lineNumber === undefined ||
    column === undefined ||
    title === undefined
  ) {
    return undefined;
  }
  return {
    project,
    file,
    line: Number(lineNumber),
    column: Number(column),
    title: title.trimEnd(),
  };
};

/** The tests a log's flaky blocks name, each once, in the order printed. */
export const flakyTestsOf = (log: string): FlakyTest[] => {
  const tests = new Map<string, FlakyTest>();
  let inFlakyBlock = false;
  for (const raw of log.split("\n")) {
    const line = contentOf(raw);
    if (FLAKY_COUNT.test(line)) {
      inFlakyBlock = true;
      continue;
    }
    if (!inFlakyBlock) continue;
    const test = entryOf(line);
    // The block ends at the next summary line (`N failed`, `N passed`, …) or
    // a blank one; an entry that does not parse is that end.
    if (test === undefined) {
      inFlakyBlock = false;
      continue;
    }
    const key = `${test.project}\u0000${test.file}\u0000${test.title}`;
    if (!tests.has(key)) tests.set(key, test);
  }
  return [...tests.values()];
};

/**
 * The test's name without its line and column: the issue outlives a moved
 * test, and this is the form a person can search for.
 */
export const testNameOf = (test: FlakyTest): string =>
  `[${test.project}] ${test.file} › ${test.title}`;

export const flakyIssueTitle = (test: FlakyTest): string => `Flaky test: ${testNameOf(test)}`;

/** A CI run that retried the test, as the issue cites it. */
export interface FlakyRun {
  readonly url: string;
  readonly createdAt: string;
}

/**
 * One issue per test name, deduped against the open issues' titles: a test
 * that stays flaky keeps its first issue rather than opening a second.
 */
export const newFlakyTests = (
  tests: readonly FlakyTest[],
  openTitles: readonly string[],
): FlakyTest[] => {
  const tracked = new Set(openTitles.map((title) => title.trim().toLowerCase()));
  return tests.filter((test) => !tracked.has(flakyIssueTitle(test).toLowerCase()));
};

/** The issue's body: the marker, where the test lives, and the runs that retried it. */
export const flakyIssueBody = (test: FlakyTest, runs: readonly FlakyRun[]): string => {
  const evidence =
    runs.length === 0
      ? ["- (the run's log is gone)"]
      : runs.map((run) => `- ${run.url} (${run.createdAt.slice(0, 10)})`);
  return [
    "<!-- factory:flaky-test -->",
    "## Flaky test",
    "",
    `\`[${test.project}] ${test.file}:${String(test.line)}:${String(test.column)}\``,
    "",
    `Title: ${test.title}`,
    "",
    "Playwright needed a retry for this test in the last week's CI runs:",
    "",
    ...evidence,
    "",
    "A retry fails the run (`failOnFlakyTests`), so a red CI can be this test rather than the branch.",
    "",
  ].join("\n");
};
