# #129 — the shared run-log reader

**`runLog(repo, runId, { failedOnly })`** in [`packages/factory/src/shared/runs.ts`](../../../packages/factory/src/shared/runs.ts)
is the one reader of a CI run's log. It picks `gh run view --log-failed` or `--log`, owns the 128 MiB
`maxBuffer` and the `stdio` setup that every caller used to repeat, and returns the partial stdout of
a `gh` that exited non-zero. A pruned or missing log is an empty string, never a throw.

The fourth parameter, `exec`, is the test seam: the `runs.test.ts` spec injects a failing `gh` there.
Production callers pass only the three arguments.

## Callers

| Caller                            | Options                 | Then                                        |
| --------------------------------- | ----------------------- | ------------------------------------------- |
| `src/fix/decide.ts`               | `{ failedOnly: true }`  | `excerptOf` trims it to the prompt's budget |
| `src/maintain/run-red-main.ts`    | `{ failedOnly: true }`  | `excerptOf` trims it for the issue body     |
| `src/maintain/run-flaky-tests.ts` | `{ failedOnly: false }` | the whole log goes to `flakyTestsOf`        |

## Gotchas

- **Do not add a per-caller `execSync` for a log read.** The 128 MB buffer, `stdio` and error
  salvage belong to `runLog`; a new buffer size is a change there, made once.
- **`sh` is a different read.** `shared/common.ts`'s `sh` runs paginated JSON reads with a 256 MB
  cap; `run-red-main.ts`'s `gh run view --json headSha,url,jobs` still uses it, and only the log
  read goes through `runLog`.
- **An empty string is the missing-log signal.** `run-flaky-tests.ts` logs and skips a run whose log
  is empty; do not turn a pruned log into a failure of the whole pass.

Read for: any factory script that reads a run log, a new run-log reader, or a buffer/salvage change.
