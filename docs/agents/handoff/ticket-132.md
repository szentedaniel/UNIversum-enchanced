# Ticket #132 (merge gate read/perform split): extension points and gotchas

`packages/factory/src/merge/merge.ts` is now the composition root of three parts that were one
script: `facts.ts` reads, `gates.ts` decides (unchanged), `perform.ts` acts.

## The reads (`merge/facts.ts`)

- **`MergeReader`** is the seam: `pullOf`, `changedFiles`, `ciRuns`, `compareOf`, `contentAt`,
  `issueComments`, each named after the fact it yields. `merge.ts` wires the `gh`/`sh` impl as a
  `MergeReader` object; `test/merge.test.ts` hands in a fake.
- **`readMergeFacts(repo, pr, pull, reader)`** returns the exact `MergeFacts` `gates.ts` decides
  on; the pull is passed in, already read and guarded. A new read is a `MergeReader` method plus
  one field in that object; the assembly (head sha, merge base, main's lead, dependency maps) is
  what the tests pin.
- **`PullView` / `CompareView`** live here now. `PullView.closing` comes from
  `closingIssuesReferences`; `pull.body` is the fallback through `closingIssue`.
- **The pull read and the open/factory guard come first**, in `mergeGate`: a closed, fork or
  human pull request costs one `gh pr view` and no other read. The tests throw from every other
  reader to pin that. A new reader call may assume an open factory pull.

## The actions (`merge/perform.ts`)

- **`MergeActions`** is the write seam: `label`, `comment` (on the pull), `dispatchFix`, `merge`,
  `commentOnIssue`, `closeIssue`, plus `ticketTitle` — the one read the merge subject needs, kept
  lazy so a wait/fix/escalate step never reads the ticket.
- **`performStep(step, pull, ctx)`** switches on the `MergeStep` kind and prints the same lines the
  old `main` did. `ctx.dryRun` short-circuits before every write; a merge dry run still resolves
  the subject (and so reads the ticket title) before stopping.
- **`merge` returns the merge-commit oid** (the adapter does the `gh pr merge` and its `gh pr view`
  read-back); `""`/`"null"` throws, which is the fork/no-merge-commit guard.
- **The ticket comment and close happen only when the pull closes an issue.** A Dependabot bump
  closes none: it names its own pull request in the subject and posts no ticket comment (the old
  script called `gh issue comment undefined` after merging one).
- **Throwing is the failure path**: `main`'s catch hands the message to `fail`, which writes
  `failure_reason.txt`. Tests assert the throw, not a `process.exit`.

## The real adapters (`merge/merge.ts`)

- `ghReader` is the six-read object; `ghActions(repo, pr)` binds the pull and builds each `gh`
  command, including the two body-file temp files (`merge-comment.md`, `merge-done.md`).
- `waitForMergeability` owns the UNKNOWN retry: six reads, five `sleep 5` pauses; the pause is a
  parameter, so the test covers the retry without sleeping. `ghReader.pullOf` wires it to
  `readPull`.
- `main` parses the env, then `mergeGate` does pull read → open/factory guard → facts →
  `mergeStep` → `performStep`. The subjects come from
  `gates.mergeSubjectOf`: the ticket's title, or the pull request's for a dependency bump.
- The escalation is still deduped by `ready-for-human`, and the close still tolerates the pull
  request's `Closes #…` having closed the issue; the actions changed shape, not their commands.
