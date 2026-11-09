# Ticket #96 (subject length rule): what changed and what to watch

Branch `agent/issue-96-commit-rules-refuse-a-subject-longer-than-100-char`.
One rule added; no other behaviour, message or doc changed.

## The rule

- `packages/repo-checks/src/commits.ts`: `SUBJECT_LIMIT = 100` sits next to
  `SUBJECT`, and `commitProblems` pushes
  `subject is <n> characters, over the 100-character limit` when the subject
  is longer. Exactly 100 characters pass; 101 does not.
- The length check is gated on the merge path (`!gitMerge`), like the format
  rule: git's own `Merge branch …` subject on a merge commit (`parents > 1`)
  is exempt, while the same subject on a single-parent commit is refused —
  by the format rule and the length rule. It runs after the format check and
  before the period check, so a subject can report each rule it breaks.
- The count is `String.length` of `commit.message.split("\n", 1)[0]`;
  `check-commits.ts` trims each `git log` message first, so trailing
  whitespace git cleaned up is not counted. Neither `check-commits.ts` (CI)
  nor `check-message.ts` (the `commit-msg` hook) needed a change: both call
  `commitProblems`.
- `packages/repo-checks/test/commits.test.ts` pins exactly 100/101 and the
  merge exemption in the `the commit rules` block. `CODING_STANDARDS.md`
  deliberately doesn't restate enforced commit rules.

Read for: any change to `commits.ts`, the commit check or the hook tests.
