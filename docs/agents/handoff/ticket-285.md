# Ticket #285 (review retry): extension points and gotchas

Branch `agent/issue-285-factory-review-retry-a-missing-or-invalid-structur`, a factory issue of its
own. A review run whose `<review>` block is missing or invalid no longer loses the review: the
session gets a second turn, the workflow re-runs once, and only then does the pull request go to the
owner — who can review it again by dispatch without a relabel.

## The session's second turn (`packages/factory/src/review/`)

- **`verdict.ts`** is the pure retry: `reviewWithRetry(run, failureOf)`, `retryTurn(failure)` and
  `salvageReview(raw)`.
  - `reviewWithRetry` runs once, and on a `StructuredOutputError` resumes the same session
    (`retryTurn`) with the validation issue named (`mergeDanger: …`) and the previous block quoted.
    A failure with no captured `sessionId` throws instead of retrying.
  - `salvageReview` reads only `verdict` and `findings` from a raw block (fence-unwrapped, as
    Sandcastle parses it). When the retried reply still has no `mergeDanger` — or has no tag at all —
    the verdict and findings survive without a rating.
  - The `note on Sandcastle 0.14`: `output` requires `maxIterations: 1`, so there is no multi-turn
    run with structured output. The second turn is a second `sandcastle.run` with
    `resumeSession: error.sessionId` and `prompt` (and `promptFile`/`promptArgs` dropped, or
    `resolvePrompt` fails). `claudeCode` captures sessions by default (`captureSessions: true`), and
    the prompt must contain the literal `<review>` opening tag. A future Sandcastle upgrade adds
    `Output.object({ maxRetries })`; do not switch without keeping the salvage behaviour, because a
    missing `mergeDanger` alone must still post.
- **`schema.ts`**: `reviewSchema` stays the strict agent contract. `Review` is the postable shape,
  with `mergeDanger?: MergeDanger`; `riskLabel(undefined)` is `risk:high`, and `summaryComment`
  prints `**Merge danger:** not rated …` for it. `mergeDangerOf` cannot parse that line, so the
  merge gate's `riskReason` escalates to "risk:high" (a person merges).
- **`review.ts`** wires `reviewWithRetry` (`failureOf` maps Sandcastle's error fields, including the
  failed run's commit count) and writes the same three files as before.

## The run-level retry and the recovery (`packages/factory/src/review/`)

- **`retry.ts`**: `failureAction({ reviewFailed, retry })` is the one-re-run rule (only a failed
  review step, never the retry run, never a failed push). `failureComment(reason, runUrl)` opens with
  `<!-- factory-review:failed -->`; `lastFactoryCommentIsFailure` finds the newest `<!-- factory-`
  comment and checks that marker. `queueDecision({ labelled, manual, failedReview })` returns
  `queued`, `recovery` or `not-queued` — the recovery is a manual dispatch of a pull request whose
  newest factory word is the handoff, even after other comments. A later review, fix round or
  merge-gate comment makes it `not-queued`.
- **`fail.ts`** is the workflow's failure path: `REVIEW_FAILED` (the review step's outcome),
  `RETRY` (the dispatch input) and `RUN_URL` decide. A retry dispatches
  `gh workflow run factory-review.yml -f pr=<n> -f retry=true` and leaves `agent:review`; a failed
  dispatch falls through to the handoff. The handoff posts the marked comment and swaps
  `agent:review` for `ready-for-human`. It runs from the pull request's checkout, like `review.ts`.
- **`gate.ts`** now takes `LABELS` and `MANUAL`: no `agent:review` and not a manual recovery is
  `not-queued` (printed `false`); a recovery prints `true` and skips the daytime quota, so a manual
  dispatch runs at once. The quota comment read is repo-wide `gh api` only for a queued run.
  Preflight lets a manual dispatch through when the label is missing and outputs `labels`; the gate
  makes the decision, because only it runs main's code.

## The workflow (`.github/workflows/factory-review.yml`) and docs

- New input `retry` (default false) and ` (retry)` in the run name. The last step is
  `node packages/factory/src/review/fail.ts` with `REVIEW_FAILED: steps.review.outcome == 'failure'`
  and `RETRY: inputs.retry`. The retry run sets `retry: true`, so its failure hands over.
- `docs/agents/factory.md` § Reviewing a pull request steps 1, 3 and 5 describe the queue gate,
  the session's second turn and the run retry/recovery. `docs/agents/implementer.md` is unchanged.
- The merge gate is untouched: an unrated review still posts, labels `risk:high`, and its danger
  line is unreadable to `mergeDangerOf`, so the gate waits for a person.

## Tests

`packages/factory/test/verdict.test.ts` (session retry, salvage, no-session, non-structured error)
and `packages/factory/test/retry.test.ts` (one re-run, handoff comment marker, newest-factory-comment
read, recovery queue decision) are the regression net; `summary.test.ts` and `gates.test.ts` still pin
the rated path. The workflow's `if:` expressions are not covered by a test: the branches they read
live in `retry.ts`/`gate.ts`.
