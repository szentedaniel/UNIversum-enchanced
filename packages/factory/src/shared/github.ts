/**
 * The `gh api` reads the factory's scripts share. GitHub's REST shapes are the
 * callers' interfaces: a schema here would only restate the docs.
 */
import type { ReviewComment } from "#review/summary.ts";
import { sh } from "#shared/common.ts";

/** Untrusted JSON, typed by the caller's interface. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the one untyped JSON boundary; each caller names its REST shape
export const parseJson = <T>(raw: string): T => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untrusted JSON, typed by the caller
  return JSON.parse(raw) as T;
};

/** A `gh api --paginate --jq '.[] | {…}'` read: one JSON object per line. */
export const jsonLines = <T>(raw: string): T[] =>
  raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parseJson<T>(line));

/**
 * A paginated `gh api` response, one flat list. `--slurp` wraps each page in
 * an array, so a single-object endpoint also arrives as one entry.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the one untyped JSON boundary; each caller names its REST shape
export const api = <T>(path: string): T[] => {
  const pages: unknown[] = JSON.parse(sh(`gh api --paginate --slurp "${path}"`));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untrusted JSON, typed by the caller
  return pages.flat() as T[];
};

/** Every comment on an issue or pull request, oldest first. */
export const issueComments = (repo: string, number: string): ReviewComment[] =>
  jsonLines<ReviewComment>(
    sh(
      `gh api "repos/${repo}/issues/${number}/comments?per_page=100" --paginate --jq '.[] | {body: .body, createdAt: .created_at}'`,
    ),
  );
