/**
 * The factory's `gh` boundary. Every call runs with an argument array, so an
 * issue number, a path or an agent's title never reaches a shell. GitHub's
 * REST shapes are the callers' interfaces: a schema here would only restate
 * the docs.
 */
import { execFileSync } from "node:child_process";
import type { ReviewComment } from "#review/summary.ts";

/**
 * Room for a month of paginated runs and jobs: execFileSync's 1 MB default
 * overflowed (`ENOBUFS`) once the dispatcher's jobs read passed it.
 */
const GH_MAX_BUFFER = 256 * 1024 * 1024;

/** `gh` with an argument array; stdout as text, a non-zero exit throws. */
export const gh = (args: readonly string[]): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: GH_MAX_BUFFER,
  });

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
  const pages = parseJson<unknown[]>(gh(["api", "--paginate", "--slurp", path]));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the flattened pages are the caller's REST shape
  return pages.flat() as T[];
};

/** Every comment on an issue or pull request, oldest first. */
export const issueComments = (repo: string, number: string): ReviewComment[] =>
  jsonLines<ReviewComment>(
    gh([
      "api",
      `repos/${repo}/issues/${number}/comments?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | {body: .body, createdAt: .created_at}",
    ]),
  );
