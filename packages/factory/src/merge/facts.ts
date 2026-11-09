/**
 * The merge gate's reads: one pull request's fields, its changed files, the CI
 * runs on its head, the review comments, main's lead over the head and the
 * dependency maps on both sides of the merge base. `MergeReader` is the seam:
 * `merge.ts` wires it to `gh`, the tests hand in a fake, so the assembly that
 * went wrong before (the compare, the merge base, the dependency maps) is
 * reachable without GitHub.
 */
import { dependencyMap, type CiRun, type DependencyChange, type MergeFacts } from "#merge/gates.ts";
import type { ReviewComment } from "#review/summary.ts";
import { parseJson } from "#shared/github.ts";

/** The fields of `gh pr view` the gate reads, as the jq object `merge.ts` builds. */
export interface PullView {
  number: number;
  state: string;
  title: string;
  body: string | null;
  headRefName: string;
  headRefOid: string;
  mergeStateStatus: string;
  labels: string[];
  closing: number[];
  headCommittedAt: string;
  /** The REST login: `dependabot[bot]` for a dependency bump. */
  author: string;
}

/** What `repos/…/compare/<head>...main` says about the base branch. */
export interface CompareView {
  mergeBase: string;
  /** `ahead_by` for `<head>...main`: how far main is ahead of the pull request. */
  mainAheadBy: number;
  files: string[];
}

/** Every `gh` read the gate does, named for the fact it yields. */
export interface MergeReader {
  pullOf(repo: string, pr: string): PullView;
  changedFiles(repo: string, pr: string): string[];
  ciRuns(repo: string, branch: string): CiRun[];
  compareOf(repo: string, headSha: string): CompareView;
  /** A file's content at a ref, or `undefined` when it does not exist there. */
  contentAt(repo: string, path: string, ref: string): string | undefined;
  issueComments(repo: string, pr: string): ReviewComment[];
}

const dependenciesAt = (reader: MergeReader, repo: string, file: string, ref: string): unknown => {
  const content = reader.contentAt(repo, file, ref);
  if (content === undefined) return undefined;
  try {
    return parseJson<unknown>(content);
  } catch {
    throw new Error(`${file} at ${ref} is not valid JSON.`);
  }
};

/** The dependency maps of every package.json the pull request changes. */
const dependencyChanges = (
  reader: MergeReader,
  repo: string,
  files: readonly string[],
  mergeBase: string,
  headSha: string,
): DependencyChange[] =>
  files
    .filter((file) => file.endsWith("package.json"))
    .flatMap((file) => {
      const before = dependenciesAt(reader, repo, file, mergeBase);
      const after = dependenciesAt(reader, repo, file, headSha);
      if (before === undefined || after === undefined) return [];
      return [{ file, before: dependencyMap(before), after: dependencyMap(after) }];
    });

/**
 * One pull request's decision facts. The pull request itself comes back too:
 * `main` checks that it is open and a factory pull before deciding, and every
 * action names it.
 */
export const readMergeFacts = (
  repo: string,
  pr: string,
  reader: MergeReader,
): { pull: PullView; facts: MergeFacts } => {
  const pull = reader.pullOf(repo, pr);
  const files = reader.changedFiles(repo, pr);
  const base = reader.compareOf(repo, pull.headRefOid);
  const facts: MergeFacts = {
    headSha: pull.headRefOid,
    headCommittedAt: pull.headCommittedAt,
    labels: pull.labels,
    ciRuns: reader.ciRuns(repo, pull.headRefName),
    comments: reader.issueComments(repo, pr),
    files,
    dependencyChanges: dependencyChanges(reader, repo, files, base.mergeBase, pull.headRefOid),
    mergeState: pull.mergeStateStatus.toLowerCase(),
    mainAheadBy: base.mainAheadBy,
    mainFiles: base.files,
  };
  return { pull, facts };
};
