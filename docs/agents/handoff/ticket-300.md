# Ticket #300 (advisory-only review findings): extension points and gotchas

Branch `agent/issue-300-factory-advisory-only-review-findings-after-the-fi`. A review finding now
carries a `blocking` or `advisory` severity. A review that asks for changes only over advisory
findings no longer escalates after the fix rounds: the merge gate decides as if the review had
passed, and the merge files one `needs-triage` issue with the findings. No workflow changed.

## The finding severity (`packages/factory/src/review/`)

- **`schema.ts`**: `FINDING_SEVERITIES` (`blocking` | `advisory`), `ReviewFinding` (`{text,
  severity}`), `ratedFindings` and `reviewOf`. The schema's `findings` accepts an object with an
  optional `severity` and a bare string; an unrated finding is **blocking**, the fallback that keeps
  an older prompt's review behaving as before. `Review.findings` is a `ReviewFinding[]`, so every
  `summaryComment` caller passes objects.
- **`summary.ts`**: the summary writes `- **Blocking:** …` / `- **Advisory:** …`, and
  `findingsOf(comment)` reads them back into `{blocking, advisory}` text lists.
  `advisoryOnly(comment)` is the one rule: a `changes-requested` comment with zero blocking and at
  least one advisory finding. `FINDINGS_INTRO` and `NO_FINDINGS` (the `- None: …` placeholder) are
  private constants the writer and the reader share — change them together. A bare `- finding` line
  (a comment from before the severities) reads as blocking.
- **`verdict.ts`** salvages a reply without `mergeDanger` through `ratedFindings`, so a salvaged
  comment keeps the severities it wrote.
- **`prompt.md`** defines the two severities and asks for `changes-requested` only with at least one
  blocking finding. Keep it in step with the schema enum and `advisoryOnly`.

## The merge gate and the follow-up issue (`packages/factory/src/merge/`)

- **`gates.ts`**: `reviewState` returns `pass` for an advisory-only `changes-requested` comment, so
  `canAutoMerge` and `mergeStep` needed no separate branch. `MergeStep`'s `merge` variant carries
  `advisory: readonly string[]`, the newest review's advisory findings. A new `MergeStep` kind must
  still exhaust the switch in `perform.ts`.
- **`comment.ts`**: `followUpIssue(pull, findings)` builds the issue: `Factory review follow-ups:
  #<pull>`, the findings, and `labels: ["needs-triage"]`.
- **`perform.ts`**: `MergeActions.fileFollowUp(issue)` is called **after** the merge commit is read
  back and the ticket is closed; a dry run or a refused merge files nothing. `merge.ts` runs
  `gh issue create … --label needs-triage` for it.

## The fix loop (`packages/factory/src/fix/`)

- **`rounds.ts`**: `fixPlan(rounds, reason, advisoryOnly)` composes `fixDecision` with the advisory
  rule: `review` + advisory-only → `{action: "merge-gate"}` (no round, no escalation); otherwise a
  free round or the escalation. A `ci` trigger ignores the advisory flag: red CI keeps its rounds.
- **`decide.ts`**: reads `advisoryOnly(newestMarkerComment(comments)?.body ?? "")` and writes
  `plan.json` with `run: false, escalate: false` for the stand-down, so the workflow's existing
  steps run neither omp nor the escalation. No workflow change was needed.

## Gotchas

- **The merge gate reads the comment, never `review.json`.** The gate runs main's code on the pull
  request it is deciding, so the summary's finding lines are the contract: the severity labels, the
  intro line and the `- None:` placeholder are parsed.
- **An advisory-only stand-down leaves no label.** The pull request waits for the merge gate's own
  triggers (CI success, review completion, the hourly backstop); `decide.ts` does not dispatch it.
- **The follow-up is one issue per merge.** `#<pull>` in its body is the link; the title numbers the
  pull request. The nightly intake owns the next step, not the merge gate.
