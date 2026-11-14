/**
 * The merge gate's reads: one pull request's fields, its changed files, the CI
 * runs on its head, the review comments, main's lead over the head and the
 * dependency maps on both sides of the merge base. `MergeReader` is the seam:
 * `merge.ts` wires it to `gh`, the tests hand in a fake, so the assembly that
 * went wrong before (the compare, the merge base, the dependency maps) is
 * reachable without GitHub.
 */
import { dependencyMap, type CiRun, type DependencyChange, type MergeFacts } from "#merge/gates.ts";
import { isMigrationPath, MIGRATION_FILES, type MigrationFacts } from "#merge/migration.ts";
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
  /** The author's login: `dependabot[bot]` (REST) or `app/dependabot` (`gh`) for a dependency bump. */
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
  /** The state fixtures directory's file names at a ref, or `undefined` when it is absent. */
  fixtureNames(repo: string, ref: string): string[] | undefined;
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
 * The migration check's sources, read only when the pull request touches a
 * migration path: main's tip and the head are what the check compares, and
 * the merge base tells a migration racing main's from a branch that has not
 * bumped at all. A pull request outside those paths costs no reads.
 */
const migrationFacts = (
  reader: MergeReader,
  repo: string,
  files: readonly string[],
  mergeBase: string,
  headSha: string,
): MigrationFacts | undefined => {
  if (!files.some(isMigrationPath)) return undefined;
  const content = (path: string, ref: string): string | undefined =>
    reader.contentAt(repo, path, ref);
  return {
    stateBase: content(MIGRATION_FILES.state, mergeBase),
    stateMain: content(MIGRATION_FILES.state, "main"),
    stateHead: content(MIGRATION_FILES.state, headSha),
    migrateMain: content(MIGRATION_FILES.migrate, "main"),
    migrateHead: content(MIGRATION_FILES.migrate, headSha),
    testHead: content(MIGRATION_FILES.test, headSha),
    fixturesMain: reader.fixtureNames(repo, "main"),
    fixturesHead: reader.fixtureNames(repo, headSha),
    files,
  };
};

/**
 * One pull request's decision facts, once `mergeGate` has read the pull and
 * checked it is open and a factory pull. The pull is passed in so that guard
 * stays the first read: these must not run for a pull request the gate leaves
 * alone (a closed one, a fork, a human's).
 */
export const readMergeFacts = (
  repo: string,
  pr: string,
  pull: PullView,
  reader: MergeReader,
): MergeFacts => {
  const files = reader.changedFiles(repo, pr);
  const base = reader.compareOf(repo, pull.headRefOid);
  return {
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
    migration: migrationFacts(reader, repo, files, base.mergeBase, pull.headRefOid),
  };
};
