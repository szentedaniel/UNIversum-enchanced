# Ticket #141 (red main: the merge subject broke the commit rules): what changed and what to watch

Branch `agent/issue-141-red-main-ci-failed-on-a52ec25`. Red main was `a52ec25`: its merge
subject, `chore(merge): #115 Turn deadline module: …`, was 113 characters, over the commit
rules' 100. The generator was the merge gate, not the commit check.

## The fix

- `packages/factory/src/shared/subject.ts`: `subjectOf(prefix, title)` builds a subject the
  commit check accepts — whitespace collapsed, cut at a word boundary when it passes the
  100-character limit, trailing separators and whitespace stripped. The limit is mirrored
  from `packages/repo-checks/src/commits.ts`; change both together.
- `mergeSubjectOf` (`src/merge/gates.ts`) runs both the ticket name (`#<n> <title>`) and the
  Dependabot pull name through it. A ticket title has 19 characters less room than the
  ticket's own limit (`chore(merge): #115 `), so intake's under-100 title rule is not enough.
- The retro's `commitSubjectOf` in `src/retro/plan.ts` uses the same helper; its
  `standards update` fallback stays for an empty title.

## Gotchas

- The commit check exempts only git's _own_ `Merge …` subject on a merge commit; a
  `chore(merge): …` subject is checked like any other, which is what caught this. Do not
  widen the exemption — fix the generator.
- The merge gate runs from a checkout of `main`, so a change to `mergeSubjectOf` only takes
  effect for merges after it lands on main. The merge that lands it must have a short title.
- Red main's issue body carries only the failed job's log; there is no Implementation
  context comment, so the fix has to be read from the failure itself.

Read for: the #87/#91/#96 handoffs, any merge-subject, retro-commit or red-main touch.
