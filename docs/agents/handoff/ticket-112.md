# Ticket #112 (shared run log): extension points and gotchas

Branch `agent/issue-112-shared-run-log-module-one-runlog-repo-runid-failed`.
`packages/factory/src/shared/runs.ts` now owns the factory's one read of a workflow run's log; the
fix loop and both maintenance passes call it.

## The interface

- `runLog(repo, runId, { failedOnly })` returns the log text. `failedOnly: true` runs
  `gh run view <id> --repo "<repo>" --log-failed`; `false` runs `--log`.
- The 128 MB `maxBuffer` lives once (`LOG_MAX_BUFFER`), as does the recovery: a failed read yields
  the error's partial `stdout` when it is a string, else `""`. An expired log is `""`; the function
  never throws.
- The fourth, optional argument is the command runner (`CommandRunner`). `test/runs.test.ts`
  injects one that returns or throws, so the failure handling is tested without stubbing
  `node:child_process`. Production callers pass three arguments.
- Callers keep their own shaping: `fix/decide.ts` trims with `excerptOf`,
  `maintain/run-red-main.ts` keeps `"(no failed-step log output)"`, and
  `maintain/run-flaky-tests.ts` skips an empty log with a log line.

## Gotchas

- `test/runs.test.ts` pins the exact command strings. Changing the repo quoting or the flag changes
  that test.
- `sh` in `shared/common.ts` keeps its own 256 MB cap for `gh api` reads. The log cap is
  deliberately the smaller 128 MB and must not reuse `sh`: a log read needs its own recovery.
- A command runner that throws without a string `stdout` is the expired-log path, not an error:
  returning `""` is what lets the fix loop still open an escalation and the flaky pass skip a run.
