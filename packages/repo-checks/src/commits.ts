/**
 * The commit-message rules, checked by `pnpm run check:commits` locally and
 * in CI (`src/check-commits.ts`). This list is the one source of the allowed
 * types; `CODING_STANDARDS.md` no longer restates it.
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
/** Git's own subject for a merge it wrote (`Merge branch 'x' into y`). */
const GIT_MERGE_SUBJECT = /^Merge (branch|remote-tracking branch|pull request) /;
const ATTRIBUTION = /^\s*(co-authored-by:|\S*\s*generated with\b)/im;

/** Why `commit`'s message breaks the rules; empty when it follows them. */
export function commitProblems(commit: Commit): string[] {
  const subject = commit.message.split("\n", 1)[0] ?? "";
  const problems: string[] = [];
  const gitMerge = commit.parents > 1 && GIT_MERGE_SUBJECT.test(subject);
  if (!gitMerge && !SUBJECT.test(subject)) {
    problems.push(
      `subject is not \`type(scope): description\` with a type of ${COMMIT_TYPES.join(", ")}`,
    );
  }
  if (subject.endsWith(".")) problems.push("subject ends with a period");
  const attribution = ATTRIBUTION.exec(commit.message);
  if (attribution) problems.push(`carries an attribution line: "${attribution[0].trim()}"`);
  return problems;
}
