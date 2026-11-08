# Ticket #94 (subject period rule): what changed and what to watch

Branch `agent/issue-94-commit-rules-refuse-a-subject-ending-with-a-period`.
One rule added; no other behaviour, message or doc changed.

## The rule

- `packages/repo-checks/src/commits.ts`: `commitProblems` pushes
  `subject ends with a period` when the subject ends with `.`, so `...` is
  refused too and `?` or `)` pass. It runs after the `SUBJECT` check and
  independently of it, so `wip: try again.` reports two problems.
- The check is **not** gated on the merge path. Git's own `Merge branch …`
  subject never ends with a period, so a real merge still passes unchanged;
  a hand-written merge subject that ends with one is refused like any other.
- The subject is `commit.message.split("\n", 1)[0]` and `check-commits.ts`
  trims each `git log` message, so git's own trailing-whitespace cleanup is
  already applied. Neither `check-commits.ts` (CI) nor `check-message.ts`
  (the `commit-msg` hook) needed a change: both call `commitProblems`.
- `packages/repo-checks/test/commits.test.ts` pins the message text, the
  `...` case and `?`/`)` acceptance in the `the commit rules` block; the
  existing merge test covers the merge acceptance. `CODING_STANDARDS.md`
  deliberately doesn't restate enforced commit rules.

Read for: any change to `commits.ts`, the commit check or the hook tests.
