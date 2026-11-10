/**
 * The factory's `gh` seam: the argument-array reader and the shared `gh api`
 * pagination. GitHub's REST shapes are the callers' interfaces: a schema here
 * would only restate the docs.
 */
import { execFileSync } from "node:child_process";
import type { ReviewComment } from "#review/summary.ts";
import { sh } from "#shared/common.ts";

/**
 * Room for a month of paginated runs and jobs: execFileSync's 1 MB default
 * overflowed (`ENOBUFS`) once the dispatcher's jobs read passed it.
 */
const GH_MAX_BUFFER = 256 * 1024 * 1024;

/** `gh` with an argument array; stdout as text, a non-zero exit throws. */
export const gh = (args: readonly string[]): string =>
  execFileSync("gh", [...args], {
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

const STATUS_LINE = /^HTTP\/[\d.]+ \d{3}/u;

/**
 * A `gh api --include` response's body: gh prints every page's status line and
 * headers to stdout before that page's body, so the gate's reads can ask for
 * the headers (a refusal then names its wait) and still parse only the body.
 */
export const apiBody = (text: string): string => {
  const lines: string[] = [];
  let inHeaders = false;
  for (const line of text.split("\n")) {
    if (STATUS_LINE.test(line)) {
      inHeaders = true;
      continue;
    }
    if (inHeaders) {
      // The headers end at the blank line gh prints after them.
      if (line.trimEnd() === "") inHeaders = false;
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
};

/** Every comment on an issue or pull request, oldest first. */
export const issueComments = (repo: string, number: string): ReviewComment[] =>
  jsonLines<ReviewComment>(
    apiBody(
      sh(
        `gh api -i "repos/${repo}/issues/${number}/comments?per_page=100" --paginate --jq '.[] | {body: .body, createdAt: .created_at}'`,
      ),
    ),
  );

/**
 * Everything a failed `gh` call left behind, as one text: exec's message
 * repeats the reason, and `gh api --include` prints the response's headers to
 * stdout, so the wait a refusal names comes from either stream.
 */
const textOf = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error);
  const parts: string[] = [];
  if ("stdout" in error && typeof error.stdout === "string") parts.push(error.stdout);
  if ("stderr" in error && typeof error.stderr === "string") parts.push(error.stderr);
  if ("message" in error && typeof error.message === "string") parts.push(error.message);
  return parts.join("\n");
};

/** The HTTP status a refusal's text names (`gh: … (HTTP 403)`), when it names one. */
const httpStatusOf = (text: string): number | undefined => {
  const match = /\(HTTP (\d{3})\)/u.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/** GitHub's statuses for a refusal: the primary rate limit and the secondary one. */
const RATE_LIMIT_STATUSES = new Set([403, 429]);

/** A missing file is the one refusal the gate tolerates; everything else throws. */
export const isNotFound = (error: unknown): boolean => httpStatusOf(textOf(error)) === 404;

/**
 * Whether GitHub refused the call for a rate limit. REST sends a 403 or 429;
 * a GraphQL call (`pr view`, `issue view`) names the limit with no status. A
 * 5xx that happens to say "rate limit" is a server fault, not a refusal to
 * wait out.
 */
export const isRateLimit = (error: unknown): boolean => {
  const text = textOf(error);
  if (!/rate limit/iu.test(text)) return false;
  const status = httpStatusOf(text);
  return status === undefined || RATE_LIMIT_STATUSES.has(status);
};

/** The default waits between attempts, for a refusal that names none: 30 s, 2 min, 5 min. */
export const RATE_LIMIT_WAITS_MS: readonly number[] = [30_000, 120_000, 300_000];

/** The most one run sleeps over all its `gh` calls; the merge job times out at 15 min. */
export const RATE_LIMIT_TOTAL_WAIT_MS = 10 * 60_000;

/** What one run's `gh` calls have spent of that wait; they share it. */
export interface RetryBudget {
  spentMs: number;
}

export interface RetryOptions {
  /** Sleeps between attempts; a test hands in a counter. */
  readonly pause?: (ms: number) => void;
  /** The clock an `x-ratelimit-reset` instant is measured against. */
  readonly now?: () => number;
  /** The run's shared budget, fresh when absent. */
  readonly budget?: RetryBudget;
}

/** Every attempt was refused and the wait budget is spent: a later run retries. */
export class RateLimitExhausted extends Error {
  /** What the run had already waited, for the log line. */
  readonly waitedMs: number;

  constructor(waitedMs: number) {
    super(
      `GitHub kept refusing with a rate limit; waited ${String(Math.round(waitedMs / 1000))}s of ${String(RATE_LIMIT_TOTAL_WAIT_MS / 1000)}s. A later run retries.`,
    );
    this.name = "RateLimitExhausted";
    this.waitedMs = waitedMs;
  }
}

/** A refusal's first `name: digits` line, in seconds. */
const headerSeconds = (text: string, name: string): number | undefined => {
  const match = new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "imu").exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

/** The wait a refusal names, or `undefined`: `retry-after` first, then the reset instant. */
const waitOf = (error: unknown, now: number): number | undefined => {
  const text = textOf(error);
  const after = headerSeconds(text, "retry-after");
  if (after !== undefined) return Math.max(0, after * 1000);
  const reset = headerSeconds(text, "x-ratelimit-reset");
  return reset === undefined ? undefined : Math.max(0, reset * 1000 - now);
};

/** Pauses the process; `sleep` takes whole seconds. */
const sleepMs = (ms: number): void => {
  sh(`sleep ${String(Math.ceil(ms / 1000))}`);
};

/**
 * Runs one `gh` call, waiting out a rate-limit refusal and trying again. A wait
 * the refusal names wins over the fixed schedule, and a wait past what the run
 * has left of its budget is not taken at all: the next run does the work
 * instead of the job timing out. Anything else that fails, and exhaustion,
 * throws.
 */
export const retryOnRateLimit = <T>(run: () => T, options: RetryOptions = {}): T => {
  const { pause = sleepMs, now = Date.now, budget = { spentMs: 0 } } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return run();
    } catch (error) {
      if (!isRateLimit(error)) throw error;
      const scheduled = RATE_LIMIT_WAITS_MS[attempt];
      if (scheduled === undefined) throw new RateLimitExhausted(budget.spentMs);
      const wait = waitOf(error, now()) ?? scheduled;
      if (budget.spentMs + wait > RATE_LIMIT_TOTAL_WAIT_MS) {
        throw new RateLimitExhausted(budget.spentMs);
      }
      if (wait > 0) pause(wait);
      budget.spentMs += wait;
    }
  }
};
