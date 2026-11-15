# Ticket #344 (one pull request, two merge-gate runs): extension points and gotchas

Branch `agent/issue-344-merge-gate-two-concurrent-runs-for-one-pull-reques`. The merge gate is
idempotent against a second run that decides the same pull request at the same moment: an
already-in-progress merge no longer fails the run, and the waiting comment is posted once. No workflow
changed.

## The incident

On 2026-11-14/15 one pull request's merge gate ran twice at the same moment: duplicate
`<!-- factory-merge -->` "waiting for a human" comments on #296 (01:26:17 and 01:26:18) and #313
(01:25:51 and 01:25:53), and a false owner comment on #312 at 01:25:56 quoting
`GraphQL: Merge already in progress (mergePullRequest)`.

**The suspected cause is the concurrency group in `.github/workflows/factory-merge.yml`.** The group is
`factory-merge-${{ inputs.pr || github.event.workflow_run.pull_requests[0].number || github.run_id }}`.
When `workflow_run.pull_requests` is empty — which GitHub does when it cannot tie the run to a pull
request — the fallback is `github.run_id`, which differs for every run, so the CI-completed and the
Factory Review-completed triggers of **one** pull request do not share a group and nothing serialises
them. The number is still resolved in the job's first step (from `inputs.pr`, the event payload, or
the `Factory review #<n>` display title), so the decision itself is right; only the group is not.

The workflow is a protected path: **the owner makes that change.** A group derived from the pull
request found by head SHA rather than `run_id` is the fix — both triggers of one pull request name the
same `workflow_run.head_sha`, so that commit's pull request (`repos/<repo>/commits/<sha>/pulls`) is the
number the group needs. A dispatch that already knows the number keeps the `inputs.pr` arm. Do not key
the group on `github.event.workflow_run.head_sha` alone unless the `workflow_dispatch` run (which has
no `workflow_run`) keeps its own arm: its head is main, not the pull request.

## The merge step (`packages/factory/src/merge/perform.ts`)

- **`isMergeInProgress(error)`** (`packages/factory/src/shared/github.ts`) is the one predicate for
  the refusal: the text of the thrown `gh` error contains `Merge already in progress`,
  case-insensitively, and nothing else about it is reliable (GitHub sends it as a GraphQL error). It
  sits next to `isNotFound` / `isConflict` and uses the same `textOf`/joined-streams reader.
- **`mergePull`** wraps only the `merge` call in the try. On that refusal it calls
  **`MergeActions.mergeProgress()`** once and reads `"merged"` or `"merge-queued"` as "another run has
  it": it logs `Another run's merge has #<n> (<progress>); leaving it to that run.` and returns before
  the merge-commit read-back, the ticket comment, the ticket close and the advisory follow-up issue —
  the run that merges does that bookkeeping. A read of `"open"` rethrows the refusal, so the workflow's
  `failure()` step keeps its meaning for a refusal that is not another run's merge. A different merge
  error is never looked at twice (`mergeProgress` is not called).
- **`MergeProgress`** is `"merged" | "merge-queued" | "open"`. The adapter
  (`merge/merge.ts`, `mergeProgressOf`) reads `gh pr view --json state,autoMergeRequest`: `MERGED` is
  `"merged"`; an `autoMergeRequest` (the pull request queued to merge when its checks pass) is
  `"merge-queued"`; everything else is `"open"`.
- **The residual race**: the re-read is a separate API call after the refusal, so a merge that is
  still being written server-side can read `"open"` and rethrow. The workflow's concurrency group is
  what closes that window; the re-read covers the refusal arriving after the other merge landed (the
  #312 shape).
- `mergeProgress` is a **read on the actions seam**, and `mergeGate` wraps it with the same
  `retryOnRateLimit` as `ticketTitle` and the reader's methods; it is never retried as a write.

## The waiting comment (`performStep`'s `escalate` case)

- **`MergeActions.comments()`** is the second read on the actions seam, also rate-limit wrapped in
  `mergeGate`; `ghActions.comments` is the existing `issueComments(repo, pr)` reader.
- **`newestEscalation(comments)`** (`merge/comment.ts`, next to `escalationComment` and
  `MERGE_ESCALATED_MARKER`) is the newest comment whose body carries the marker, by `createdAt`. The
  escalate case builds `escalationComment(step.reasons)` and, when the newest one's body equals it
  after `trim()`, logs and posts nothing. The `ready-for-human` label still goes on in both paths:
  adding an existing label is a no-op, and the label is what holds the pull request — a run that
  crashed between its comment and its label must not leave the pull request unheld.
- The read is taken **after** the decision, not from the facts `readMergeFacts` returned: a second run
  read those before the first run posted. The gap between this read and the post is what the
  concurrency group covers.
- Reasons come out of `canAutoMerge` in a fixed order, so two runs with the same facts build the same
  body; a changed reason is a new comment, deliberately.

## Tests (`packages/factory/test/merge.test.ts`)

- `performStep`: "leaves a merge another run has done or queued to that run" (both progresses, asserts
  the attempt is the only write), "fails an in-progress refusal whose re-read still finds the pull
  request open", "fails a merge GitHub refused for another reason without re-reading it", "posts no
  second waiting comment when the newest factory-merge one already says it" (with a newer review
  comment on top, which must not reset the dedupe), "posts a new waiting comment when the newest one
  names other reasons".
- `the gate's entry`: "exits green when another merge for the pull request is in progress" spawns
  `src/merge/merge.ts` with a fake `gh` whose `pr merge` exits 1 with the GraphQL error and whose
  `pr view --json state,autoMergeRequest` answers `{"state":"MERGED",...}`; it pins that command and
  asserts no comment, label, close or create ran. The `actions()` test factory defaults
  `mergeProgress` to `"open"`, so a test that expects the refusal tolerated has to name the progress.
