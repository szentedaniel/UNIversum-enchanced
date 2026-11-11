# Ticket #165 (rate-limit retries in the gh seam): extension points and gotchas

The merge gate no longer escalates when GitHub refuses a call for a rate limit: it waits and retries
the reads, and a run whose budget cannot outlast the refusal — or any refused write — exits green so a
later run decides.

## The retry (`packages/factory/src/shared/github.ts`)

- **The `isRateLimit` predicate** is the one place the rule lives: the text (`stdout`, `stderr` and
  `message` of the thrown exec error, joined by `textOf`) says "rate limit" and either names no HTTP
  status (a GraphQL error from `pr view`/`issue view`) or names 403/429. A 5xx that mentions a rate
  limit is a server fault and does not retry.
- **The headers are live**: every `gh api` read the gate makes passes `-i`, so a refusal's stdout
  carries `retry-after` / `x-ratelimit-reset`; `apiBody` drops the status line and headers from a
  successful response before parsing. `retry-after` wins over `x-ratelimit-reset`, which is measured
  against `now`; without either the fixed schedule is 30 s, 2 min, 5 min.
- **`retryOnRateLimit(run, options)`** runs one call and waits out a refusal. Three retries, then
  `RateLimitExhausted`. **`RetryOptions`** is the test seam: `pause`, `now` and the shared `budget`;
  a wait that would pass `RATE_LIMIT_TOTAL_WAIT_MS` (10 minutes; the job times out at 15) is not
  taken at all.
- **`isNotFound(error)`** (HTTP 404) is the only refusal a reader may swallow; see `contentAt` below.

## The gate (`packages/factory/src/merge/merge.ts`)

- **`mergeGate` wraps every read**: `reads` binds each `MergeReader` method through one local
  `retryRead`, all sharing one budget; `ticketTitle` (the actions interface's one read) is wrapped the
  same way.
- **Writes are never retried**: `label`, `comment`, `dispatchFix`, `merge`, `commentOnIssue` and
  `closeIssue` stay bare. A 403/429 did not apply, but retrying a merge whose read-back was refused
  would merge twice (or escalate "already merged"), and retrying a comment can post it twice. A
  refused write returns `"rate-limited"`; the next run decides again.
- **`mergeGate` returns `MergeGateOutcome`**: `"decided"` (the step ran: merge, wait, fix, escalate
  or leave alone) or `"rate-limited"`. The latter is a `::warning::` and a normal return, so `main`
  exits 0 and the workflow's `failure()` step — the "could not decide" comment and `ready-for-human` —
  does not run.
- **`contentAt` tolerates a 404 only**: a package.json the pull request adds or removes has no other
  side, but a rate limit there must reach the retry, not read as a missing file (it did, and a bogus
  dependency read would decide on a major bump that is not there).
- **The hourly backstop**: `factory-merge.yml`'s `schedule` re-dispatches the gate for every open
  `agent/` or `dependabot/` pull request; without it a green rate-limited run would wait for a CI or
  review event that may never come.
- The gate runs from a checkout of `main` (`factory-merge.yml`), so this fix takes effect for open
  pull requests as soon as it is merged.

## Tests

- `test/github.test.ts` pins `apiBody`'s header stripping, the `retry-after` / `x-ratelimit-reset`
  waits in `gh api --include`'s format, the fixed schedule, the REST/GraphQL/500 split, the budget
  cap, schedule exhaustion, a non-rate-limit rethrow, and that `isNotFound` tells a 404 from a
  refusal.
- `test/merge.test.ts` pins the gate with fake seams: a read refused twice still merges and posts
  no escalation; a GraphQL refusal without an HTTP status retries; a persistent read refusal returns
  `"rate-limited"` with no write; a refused write is not retried and returns `"rate-limited"`; a 404
  escapes and writes nothing. `mergeGate`'s sixth argument (`{ pause }`) is how those tests avoid
  sleeping.
- The entry test spawns `node src/merge/merge.ts` with a refusing `gh` and a no-op `sleep` on PATH:
  exit status 0, the `::warning::`, and one recorded call per attempt prove the workflow's failure step
  stays out.
