# Ticket #100 (subject whitespace rules): what changed and what to watch

Branch `agent/issue-100-commit-rules-refuse-double-or-trailing-spaces-in-a`.
Two rules added; no other behaviour, message or doc changed.

## The rules

- `packages/repo-checks/src/commits.ts`: `DOUBLE_SPACE = / {2,}/` and
  `TRAILING_WHITESPACE = /\s$/` sit next to `SUBJECT_LIMIT`, and
  `commitProblems` pushes `subject contains two or more consecutive spaces`
  and `subject ends with whitespace` when the subject breaks them. Single
  spaces pass.
- Both are gated on `!gitMerge`, like the format and length rules: git's own
  `Merge branch …` subject on a merge commit (`parents > 1`) is exempt, while
  the same subject on a single-parent commit is refused. They run after the
  period check, so a subject reports each rule it breaks — `fix:  write logs`
  reports the format rule (the description starts with a space) and the
  space rule, and a subject with two spaces plus a trailing space reports
  both whitespace rules.
- The space rule counts literal spaces (` {2,}`), not tabs; the trailing
  rule matches any whitespace (`\s$`).
- `check-commits.ts` trims each `git log` message and `check-message.ts`
  trims the edited message before calling `commitProblems`, so git's own
  trailing-whitespace cleanup means the trailing rule fires only when
  `commitProblems` is called directly (the tests); neither check needed a
  change.
- `packages/repo-checks/test/commits.test.ts` pins both messages, both
  firing together, single-space acceptance and the merge exemption in the
  `the commit rules` block. The old `fix: ` empty-description case in the
  unknown-type test became `fix:` so that test still isolates one problem
  per case. `CODING_STANDARDS.md` deliberately doesn't restate enforced
  commit rules.

Read for: any change to `commits.ts`, the commit check or the hook tests.
