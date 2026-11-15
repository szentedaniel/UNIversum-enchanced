# Ticket 311 — the heartbeat sweep for stuck pull requests

Every heartbeat tick now ends with a stuck-pull-request sweep: an open factory pull request that
GitHub left with no CI run, no review or no merge decision is nudged once per head commit, and one a
nudge did not help goes to `ready-for-human` with a comment naming what was tried.

## The decision (`packages/factory/src/schedule/sweep.ts`)

- `sweepStep({ now, pull, runs })` is the pure decision. Inputs: `SweepPull` (number, state, head
  branch/sha, author, `createdAt`, `headCommittedAt`, labels, comments) and the tick's `SweepRun[]`
  page (path, head sha, status, conclusion, `createdAt`, `updatedAt`, `displayTitle`). Output:
  `leave` (with a reason), `nudge` or `escalate`, each naming one `SweepAction`: `ci`, `review` or
  `merge`.
- The order: not open → not `isFactoryPull` → `ready-for-human`/`agent:blocked` → no CI on the head
  (30 min after the later of the PR's creation and the head commit) → CI pending or failed → green CI
  with `agent:review` and no review run created since it went green (30 min) → green CI with a
  passing review and no `factory-merge.yml` run created since the review (30 min).
- `SWEEP_GRACE_MS` is 30 minutes for every nudge and again for the escalation.
- Markers: `sweepMarker(action, sha)` = `<!-- factory-sweep:<action>:<sha> -->`; a marker younger
  than the grace leaves the pull request waiting, an older one escalates.
  `sweepEscalatedMarker` = `<!-- factory-sweep:<action>:<sha>:escalated -->` keeps the explanation
  from being posted twice if the label write failed.
- The review test uses `reviewState` from `merge/gates.ts` (now typed
  `Pick<MergeFacts, "comments" | "headCommittedAt">`, so the sweep does not build the whole
  `MergeFacts`), so "passing" includes a `changes-requested` review with advisory-only findings.

## The run (`runSweep`, same file)

`runSweep({ now, dryRun, pulls, runs, push, dispatch, comment, label, log })` decides and acts,
collecting one error line per pull request (`#<n>: …`) so one refused write cannot stop the others.
Order per nudge: **comment first** (the marker is the dedupe), then the write:

- `ci`: `push(pull)` merges main in; `"conflict"` dispatches `factory-fix.yml` with
  `-f reason=main-moved`. `"pushed"`, `"unchanged"` (the API's 204 no-op) and `"conflict"` all leave
  the marker.
- `review`: `gh workflow run factory-review.yml --ref main -f pr=<n>`.
- `merge`: `gh workflow run factory-merge.yml --ref main -f pr=<n>`.
- `escalate`: `gh pr edit --add-label ready-for-human` then the explanation comment, so the label is
  the dedupe even when the comment fails.

## Wiring (`sweepWiring`, same file)

- `pulls()`: one `gh pr list --state open --limit 100` with
  `number,state,headRefName,headRefOid,author,createdAt,labels` — **never** `comments` or `commits`
  (see Gotchas) — then one `gh pr view <n> --json comments,commits` per open factory pull request
  that does not carry `ready-for-human`/`agent:blocked`. `headCommittedAt` is the last commit's
  `committedDate`.
- `runs()`: one `gh api "repos/<repo>/actions/runs?per_page=100" --jq '.workflow_runs'` page
  (`SWEEP_RUN_PAGE`), filtered to `ci.yml`, `factory-review.yml` and `factory-merge.yml`.
- `push()`: `gh api --include --method POST "repos/<repo>/merges" -f base=<branch> -f head=main`.
  GitHub writes the merge commit with the PAT, and the push starts CI; a 409 is the conflict the fix
  loop owns (`isConflict` in `shared/github.ts`), any other refusal throws.
- `dispatch`, `comment`, `label` are capped `gh` calls. `GH_CALL_TIMEOUT_MS` moved from
  `schedule/tick.ts` to `shared/common.ts`, beside `sh`; `heartbeat-run.ts` imports it from there.

## The tick (`packages/factory/src/schedule/tick.ts`)

`TickDeps.sweep(now, dryRun, log)` returns the sweep's error lines; `runTick` runs it after the
nightly jobs and the dispatcher, catches a thrown read, and prefixes each line with `sweep: ` before
the heartbeat fails the run. `tickWiring(repo)` supplies it, so the dry tick prints the sweep's
`Dry run: would …` lines and writes nothing. A dry tick's read count is now
`JOBS.length + LIVE_STATUSES.length + 2 + one detail read per open factory pull request`
(`test/schedule-heartbeat.test.ts`).

## Tests

- `test/schedule-sweep.test.ts`: the `sweepStep` case table (closed, human's, factory-labelled,
  the grace, pending/failed CI, review dispatch, a live or already-run review, merge dispatch, an
  existing gate run, changes-requested, owned/blocked, once per head, escalation, no double
  escalation), `runSweep` writes and dry run, and a `gh` shim pinning the list/detail/runs/merges
  argv and the conflict path.
- `test/schedule-tick.test.ts`: the sweep runs after the due jobs and the dispatcher, its errors are
  collected, and a thrown sweep does not stop the tick.
- `test/schedule-heartbeat.test.ts`: the dry entry's read count and call set.

## Gotchas

- **`gh pr list --json comments,commits` is not usable here.** On this repository it makes the
  GraphQL query traverse 1,000,000 possible nodes and GitHub refuses it ("exceeds the maximum limit
  of 500,000"), which failed the tick's first live dry run. Keep the list lean and read the detail
  per factory pull request.
- The runs API has no `completed_at`; the sweep reads a completed CI run's finishing time from
  `updated_at` (verified against live runs).
- A dispatched review or merge run was started on `main`, so its `head_sha` is main's, not the pull
  request's. The sweep finds those runs by `display_title` (`Factory review #<n>`, `Factory merge
  #<n>`) with a `#<n>(?!\d)` match, and CI runs by the exact head sha.
- The CI nudge is once per head commit, and the push creates a new head when main moved, so a branch
  whose CI never starts can be pushed twice (the second merge is the 204 no-op) before the
  escalation; the escalation marker is then on the newer head. Do not "fix" this by counting markers
  across heads without rethinking the once-per-head rule the ticket states.
- The `ready-for-human` check is in both the wiring (it skips the detail read) and `sweepStep` (the
  pure rule); keep both, the second is what the tests pin.
- Do not add a per-pull runs read: review/merge dispatch runs are not on the pull request's branch,
  and the shared page is what keeps the tick to a list call plus a call per open factory pull
  request.

Read for: any change to the sweep's decision, markers, escalation, read budget or tick wiring.
