# Ticket #119 (commits module) — extension points and gotchas

Branch `agent/issue-119-repo-checks-commits-module-own-the-log-parsing-the`, from `main` after #105.

## The module

- `packages/repo-checks/src/commits.ts` owns every pure part of the commit checks:
  - `commitProblems(commit)` keeps its interface and its messages.
  - `parseLog(raw)` parses `git log --format=%H%x00%P%x00%B%x1e`: sha, parent count
    from `%P`, and the trimmed message; the empty entry after the last separator is dropped.
  - `rangeArgs(range)` turns `COMMIT_RANGE` into `git log` arguments; a range starting at
    the all-zero sha becomes `["-1", "<the rest>"]`, so a first push checks its tip alone.
  - `messageFromFile(raw)` drops `#` comment lines and everything below the `--verbose`
    scissors line, then trims, as the `commit-msg` hook needs.
- The subject rules are `SUBJECT_RULES` rows of `{ test, message, exemptOnGitMerge }`.
  `commitProblems` computes `gitMerge` once, skips the exempt rows on a merge commit, and
  maps the failing rows in table order: format, length, period, double space, tab, trailing
  whitespace. Attribution is checked separately because it reads the whole message, not the
  subject.
- A new subject rule is one row. Set `exemptOnGitMerge: false` unless git's own `Merge …`
  subject should pass it; `message` receives the subject (the length rule names its length).
- `check-commits.ts` and `check-message.ts` are now only I/O: run git or read the file,
  call the module, print and exit.

## Tests

- `packages/repo-checks/test/commits.test.ts` drives `commitProblems`, `parseLog`,
  `rangeArgs` and `messageFromFile` directly. The temp-repo tests remain only for the two
  scripts' exit codes and the hook's `MERGE_HEAD` detection.

## Gotchas

- `parseLog` relies on git's newline after `%x1e` and strips one leading `\n` per entry;
  changing the log format means changing the parser and its test together.
- `messageFromFile` trims the whole message, so the hook never sees leading or trailing
  newlines from the file.
- The scripts print unchanged messages, so a failing check or hook keeps the same text.

Read for: any commit rule, commit check or hook test change.
