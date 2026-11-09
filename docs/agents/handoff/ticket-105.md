# Ticket #105 (subject tab rule): what changed and what to watch

Branch `agent/issue-105-commit-check-should-refuse-a-tab-character-in-the`.
One rule added; no other behaviour, message or doc changed.

## The rule

- `packages/repo-checks/src/commits.ts`: `TAB = /\t/` sits next to
  `DOUBLE_SPACE` and `TRAILING_WHITESPACE`, and `commitProblems` pushes
  `subject contains a tab character` when the subject holds one. The subject
  is one line (`commit.message.split("\n", 1)[0]`), so a tab in the body is
  not checked and stays legal.
- It runs after the double-space check and before the trailing-whitespace
  check, in the same `if (!gitMerge && …)` style, so a subject reports each
  rule it breaks: `fix:\tx` also fails the format rule, and a trailing tab
  reports both the tab and the trailing-whitespace problems (the trailing
  rule matches any whitespace, `\s$`).
- It is gated on `!gitMerge` like the other whitespace, format and length
  rules: git's own `Merge branch …` subject on a merge commit
  (`parents > 1`) is exempt, while the same subject on a single-parent commit
  is refused.
- Neither `check-commits.ts` (CI) nor `check-message.ts` (the `commit-msg`
  hook) needed a change: both call `commitProblems`. `check-commits.ts` trims
  each `git log` message first, and a tab is not at the end of that subject
  after the trim, so the rule fires on the subject's interior.
- `packages/repo-checks/test/commits.test.ts` pins the interior tab, the tab
  after the colon, the trailing tab with the trailing-whitespace problem, a
  tab in the body passing, and the merge exemption in the `the commit rules`
  block. `CODING_STANDARDS.md` deliberately doesn't restate enforced commit
  rules.

Read for: any change to `commits.ts`, the commit check or the hook tests.
