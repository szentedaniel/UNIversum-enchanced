import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  apiBody,
  gh,
  isNotFound,
  isRateLimit,
  parseJson,
  RateLimitExhausted,
  RATE_LIMIT_TOTAL_WAIT_MS,
  RATE_LIMIT_WAITS_MS,
  retryOnRateLimit,
} from "#shared/github.ts";

/** A `gh` on PATH that records its argv and prints `GH_SHIM_STDOUT`. */
const SHIM = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const log = process.env["GH_SHIM_LOG"];
if (log !== undefined) {
  appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
}
process.stdout.write(process.env["GH_SHIM_STDOUT"] ?? "");
`;

const originalPath = process.env["PATH"];
let log: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "universum-gh-"));
  log = join(dir, "calls.jsonl");
  process.env["GH_SHIM_LOG"] = log;
  writeFileSync(join(dir, "gh"), SHIM);
  chmodSync(join(dir, "gh"), 0o755);
  process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
});

afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
  delete process.env["GH_SHIM_LOG"];
  delete process.env["GH_SHIM_STDOUT"];
});

const calls = (): string[][] =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseJson<string[]>(line));

describe("gh", () => {
  it("hands every argument to gh as its own word, never through a shell", () => {
    process.env["GH_SHIM_STDOUT"] = "ok";

    expect(gh(["issue", "view", "$(touch pwned)", `it's a "title"`])).toBe("ok");
    expect(calls()).toEqual([["issue", "view", "$(touch pwned)", `it's a "title"`]]);
  });
});

describe("api", () => {
  it("reads every page through gh's argument array, one flat list", () => {
    process.env["GH_SHIM_STDOUT"] = JSON.stringify([[{ id: 1 }], [{ id: 2 }, { id: 3 }]]);

    expect(api<{ id: number }>("repos/o/r/issues?state=open&per_page=100")).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(calls()).toEqual([
      ["api", "--paginate", "--slurp", "repos/o/r/issues?state=open&per_page=100"],
    ]);
  });

  it("passes a path with shell syntax to gh literally", () => {
    process.env["GH_SHIM_STDOUT"] = "[]";

    expect(api("repos/o/r/issues?since=$(date)")).toEqual([]);
    expect(calls()).toEqual([["api", "--paginate", "--slurp", "repos/o/r/issues?since=$(date)"]]);
  });
});

describe("apiBody", () => {
  it("keeps the bodies of every page and drops the status line and headers", () => {
    const response = [
      "HTTP/2.0 200 OK",
      "Content-Type: application/json\r",
      "X-Ratelimit-Reset: 1800000060\r",
      "\r",
      '{"page":1}',
      "",
      "HTTP/2.0 200 OK",
      "X-Ratelimit-Reset: 1800000120\r",
      "\r",
      '{"page":2}',
    ].join("\n");

    expect(apiBody(response)).toBe('{"page":1}\n\n{"page":2}');
  });

  it("leaves a body with no headers alone", () => {
    expect(apiBody("apps/web/src/Game.tsx\n")).toBe("apps/web/src/Game.tsx\n");
  });
});

/** A `gh` refusal as execSync throws it: the reason on stderr, the command in its message. */
const refusal = (reason: string): Error =>
  Object.assign(new Error(`Command failed: gh api repos/o/r/pulls/1/files\n${reason}\n`), {
    stdout: "",
    stderr: `${reason}\n`,
  });

/** A rate-limit refusal, with the headers `gh api --include` printed to stdout. */
const rateLimited = (headers = ""): Error =>
  Object.assign(refusal("gh: API rate limit exceeded for 1.2.3.4. (HTTP 403)"), {
    stdout: headers,
  });

/** What `retryOnRateLimit` threw, for the tests that expect exhaustion. */
const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("the call was supposed to fail");
};

describe("retryOnRateLimit", () => {
  it("retries after the wait a refusal names", () => {
    let runs = 0;
    const pauses: number[] = [];

    const value = retryOnRateLimit(
      () => {
        runs += 1;
        if (runs === 1) throw rateLimited("HTTP/2.0 403 Forbidden\nRetry-After: 45\r\n\r\n");
        return "ok";
      },
      { pause: (ms) => pauses.push(ms) },
    );

    expect(value).toBe("ok");
    expect(runs).toBe(2);
    expect(pauses).toEqual([45_000]);
  });

  it("waits until the reset instant a refusal names", () => {
    const now = 1_800_000_000_000;
    const pauses: number[] = [];
    let runs = 0;

    retryOnRateLimit(
      () => {
        runs += 1;
        if (runs === 1)
          throw rateLimited("HTTP/2.0 403 Forbidden\nX-Ratelimit-Reset: 1800000060\r\n\r\n");
        return "ok";
      },
      { pause: (ms) => pauses.push(ms), now: () => now },
    );

    expect(pauses).toEqual([60_000]);
  });

  it("retries a GraphQL rate limit that names no HTTP status", () => {
    const pauses: number[] = [];
    let runs = 0;

    const value = retryOnRateLimit(
      () => {
        runs += 1;
        if (runs === 1) {
          throw refusal("GraphQL: API rate limit exceeded for user ID 1.");
        }
        return "ok";
      },
      { pause: (ms) => pauses.push(ms) },
    );

    expect(value).toBe("ok");
    expect(runs).toBe(2);
    expect(pauses).toEqual([RATE_LIMIT_WAITS_MS[0]]);
  });

  it("falls back to the fixed schedule when a refusal names no wait", () => {
    const pauses: number[] = [];
    let runs = 0;

    const value = retryOnRateLimit(
      () => {
        runs += 1;
        if (runs <= 2) throw rateLimited();
        return "ok";
      },
      { pause: (ms) => pauses.push(ms) },
    );

    expect(value).toBe("ok");
    expect(pauses).toEqual(RATE_LIMIT_WAITS_MS.slice(0, 2));
  });

  it("retries a 429 rate limit and rethrows a 500 that mentions one", () => {
    let runs = 0;
    retryOnRateLimit(
      () => {
        runs += 1;
        if (runs === 1) throw refusal("gh: You have exceeded a secondary rate limit. (HTTP 429)");
        return "ok";
      },
      { pause: () => undefined },
    );
    expect(runs).toBe(2);

    const pauses: number[] = [];
    const serverError = refusal("gh: API rate limit exceeded (HTTP 500)");
    expect(
      caught(() =>
        retryOnRateLimit(
          () => {
            throw serverError;
          },
          { pause: (ms) => pauses.push(ms) },
        ),
      ),
    ).toBe(serverError);
    expect(pauses).toEqual([]);
  });

  it("gives up before a wait that would pass the run's budget", () => {
    const pauses: number[] = [];
    const budget = { spentMs: 0 };

    const error = caught(() =>
      retryOnRateLimit(
        () => {
          throw rateLimited("\nretry-after: 3600");
        },
        { pause: (ms) => pauses.push(ms), budget },
      ),
    );

    expect(error).toBeInstanceOf(RateLimitExhausted);
    expect(pauses).toEqual([]);
    expect(budget.spentMs).toBe(0);
  });

  it("gives up once the schedule runs out", () => {
    const pauses: number[] = [];

    const error = caught(() =>
      retryOnRateLimit(
        () => {
          throw rateLimited();
        },
        { pause: (ms) => pauses.push(ms) },
      ),
    );

    expect(error).toBeInstanceOf(RateLimitExhausted);
    expect(pauses).toHaveLength(RATE_LIMIT_WAITS_MS.length);
    if (!(error instanceof RateLimitExhausted)) throw new Error("expected exhaustion");
    expect(error.waitedMs).toBe(RATE_LIMIT_WAITS_MS.reduce((sum, wait) => sum + wait, 0));
  });

  it("counts every call's wait against one budget", () => {
    const pauses: number[] = [];
    const budget = { spentMs: RATE_LIMIT_TOTAL_WAIT_MS - 1 };

    const error = caught(() =>
      retryOnRateLimit(
        () => {
          throw rateLimited();
        },
        { pause: (ms) => pauses.push(ms), budget },
      ),
    );

    expect(error).toBeInstanceOf(RateLimitExhausted);
    expect(pauses).toEqual([]);
  });
});

describe("isNotFound", () => {
  it("tells a missing file from a refusal", () => {
    expect(isNotFound(refusal("gh: Not Found (HTTP 404)"))).toBe(true);
    expect(isNotFound(rateLimited())).toBe(false);
  });
});

describe("isRateLimit", () => {
  it("tells a REST refusal, a GraphQL refusal and a server fault apart", () => {
    expect(isRateLimit(rateLimited())).toBe(true);
    expect(isRateLimit(refusal("GraphQL: API rate limit exceeded for user ID 1."))).toBe(true);
    expect(isRateLimit(refusal("gh: API rate limit exceeded (HTTP 500)"))).toBe(false);
    expect(isRateLimit(refusal("gh: Not Found (HTTP 404)"))).toBe(false);
  });
});
