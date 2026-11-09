/**
 * The commit-message rules, checked by `pnpm run check:commits` locally and
 * in CI (`src/check-commits.ts`), and by the `commit-msg` hook
 * (`src/check-message.ts`). This list is the one source of the allowed types;
 * `CODING_STANDARDS.md` no longer restates it.
 */
export const COMMIT_TYPES = [
  "feat",
  "fix",
  "test",
  "refactor",
  "docs",
  "chore",
  "build",
  "ci",
  "style",
] as const;

/** One commit as `git log` reports it. */
export type Commit = { sha: string; parents: number; message: string };

const SUBJECT = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([^()\\s]+\\))?!?: \\S`);
/** The longest a subject may be, in characters. */
const SUBJECT_LIMIT = 100;
/** Two spaces in a row, or whitespace after the last visible character. */
const DOUBLE_SPACE = / {2,}/;
/** A tab character; the subject is the message's first line, so it can sit anywhere in it. */
const TAB = /\t/;
const TRAILING_WHITESPACE = /\s$/;
/** Git's own subject for a merge it wrote (`Merge branch 'x' into y`). */
const GIT_MERGE_SUBJECT = /^Merge (branch|remote-tracking branch|pull request) /;
const ATTRIBUTION = /^\s*(co-authored-by:|\S*\s*generated with\b)/im;
/** What git strips from a `--verbose` commit message, with the rest below it. */
const SCISSORS = "# ------------------------ >8 ------------------------";
/** A range starting at the all-zero sha is a branch's first push. */
const ALL_ZERO_RANGE = /^0+\.\./;

/** One subject rule; `message` renders the problem it found. */
type SubjectRule = {
  test: (subject: string) => boolean;
  message: (subject: string) => string;
  exemptOnGitMerge: boolean;
};

/** The subject rules, in the order their problems are reported. */
const SUBJECT_RULES: readonly SubjectRule[] = [
  {
    test: (subject) => !SUBJECT.test(subject),
    message: () =>
      `subject is not \`type(scope): description\` with a type of ${COMMIT_TYPES.join(", ")}`,
    exemptOnGitMerge: true,
  },
  {
    test: (subject) => subject.length > SUBJECT_LIMIT,
    message: (subject) =>
      `subject is ${subject.length} characters, over the ${SUBJECT_LIMIT}-character limit`,
    exemptOnGitMerge: true,
  },
  {
    test: (subject) => subject.endsWith("."),
    message: () => "subject ends with a period",
    exemptOnGitMerge: false,
  },
  {
    test: (subject) => DOUBLE_SPACE.test(subject),
    message: () => "subject contains two or more consecutive spaces",
    exemptOnGitMerge: true,
  },
  {
    test: (subject) => TAB.test(subject),
    message: () => "subject contains a tab character",
    exemptOnGitMerge: true,
  },
  {
    test: (subject) => TRAILING_WHITESPACE.test(subject),
    message: () => "subject ends with whitespace",
    exemptOnGitMerge: true,
  },
];

/** Why `commit`'s message breaks the rules; empty when it follows them. */
export function commitProblems(commit: Commit): string[] {
  const subject = commit.message.split("\n", 1)[0] ?? "";
  const gitMerge = commit.parents > 1 && GIT_MERGE_SUBJECT.test(subject);
  const problems = SUBJECT_RULES.filter(
    (rule) => !(gitMerge && rule.exemptOnGitMerge) && rule.test(subject),
  ).map((rule) => rule.message(subject));
  const attribution = ATTRIBUTION.exec(commit.message);
  if (attribution) problems.push(`carries an attribution line: "${attribution[0].trim()}"`);
  return problems;
}

/** Parses `git log --format=%H%x00%P%x00%B%x1e` output. */
export function parseLog(raw: string): Commit[] {
  return raw
    .split("\x1e")
    .map((entry) => entry.replace(/^\n/, ""))
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [sha = "", parents = "", message = ""] = entry.split("\0");
      return { sha, parents: parents.split(" ").filter(Boolean).length, message: message.trim() };
    });
}

/** The `git log` arguments for `range`; a first push checks its tip alone. */
export function rangeArgs(range: string): string[] {
  return ALL_ZERO_RANGE.test(range) ? ["-1", range.replace(ALL_ZERO_RANGE, "")] : [range];
}

/** The message git stores from a commit-message file, without its comments. */
export function messageFromFile(raw: string): string {
  return raw
    .split(SCISSORS, 1)[0]!
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}
