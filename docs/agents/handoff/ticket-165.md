# Ticket #165 (rate-limit retries in the gh seam): extension points and gotchas

The merge gate no longer escalates when GitHub refuses a call for a rate limit: it waits and retries,
and a run whose budget cannot outlast the refusal exits green so a later run decides.

## The retry (`packages/factory/src/shared/github.ts`)

- **The `isRateLimit` predicate** is the one place the rule lives: a 403 or 429 whose text says "rate
  limit". The text is `stdout`, `stderr` and `message` of the thrown exec error, joined (`textOf`), so
  a refusal from `gh api --include` (headers and body on stdout) reads the same as `gh: … (HTTP 403)`
  on stderr. A 500 that mentions a rate limit is a server fault and does not retry.
- **`retryOnRateLimit(run, options)`** runs one call and waits out a refusal. A wait the refusal
  names — `retry-after` seconds, else the `x-ratelimit-reset` epoch instant measured against `now` —
  wins over `RATE_LIMIT_WAITS_MS` (30 s, 2 min, 5 min, one per retry). Three retries, then
  `RateLimitExhausted`. In practice gh prints no headers unless the command asks (`--include`), so
  the fixed schedule is the live path; the header parser is there for a call that carries them.
- **`RetryOptions`** is the seam: `pause` (a test counts the waits), `now` (the reset clock) and
  `budget`. **`RetryBudget.spentMs`** is shared: a wait that would pass `RATE_LIMIT_TOTAL_WAIT_MS`
  (10 minutes; `factory-merge.yml`'s job times out at 15) is not taken at all, so a run's waits stay
  inside the job's timeout instead of the job dying mid-sleep.
- **`isNotFound(error)`** (HTTP 404) is the only refusal a reader may swallow; see `contentAt` below.

## The gate (`packages/factory/src/merge/merge.ts`)

- **`mergeGate` wraps both seams once**: `reads` and `writes` are `MergeReader`/`MergeActions`
  literals whose every method is `retryOnRateLimit(() => seam.method(…), options)`, all sharing one
  `{ spentMs: 0 }` budget. A new method on either interface fails typecheck until it is wrapped
  there; never add a retry loop to a caller.
- **`mergeGate` returns `MergeGateOutcome`**: `"decided"` (the step ran: merge, wait, fix, escalate
  or leave alone) or `"rate-limited"`. The latter is logged as a `::warning::` inside `mergeGate` and
  is a normal return, so `main` exits 0 and the workflow's `failure()` step — which posts the
  "could not decide" comment and adds `ready-for-human` — does not run. Only a non-rate-limit error
  reaches `fail`, and that is the escalation path (unchanged).
- **`contentAt` tolerates a 404 only**: a package.json the pull request adds or removes has no other
  side, but a rate limit there must reach the retry, not read as a missing file (it did, and a bogus
  dependency read would decide on a major bump that is not there).
- The gate runs from a checkout of `main` (`factory-merge.yml`), so this fix takes effect for open
  pull requests as soon as it is merged.

## Tests

- `test/github.test.ts` pins the helper directly: `retry-after`, `x-ratelimit-reset`, the fixed
  schedule, the 429/500 split, the budget cap, schedule exhaustion, a non-rate-limit rethrow, and
  that `isNotFound` tells a 404 from a refusal.
- `test/merge.test.ts` pins the gate with fake seams: a reader refused twice still merges and posts
  no escalation; a persistent refusal returns `"rate-limited"` with no write; a 404 escapes and
  writes nothing. `mergeGate`'s sixth argument (`{ pause }`) is how those tests avoid sleeping.
