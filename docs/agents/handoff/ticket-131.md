# Ticket #131 (one gh module) — extension points and gotchas

Branch `agent/issue-131-merge-the-two-gh-modules-intake-gh-ts-and-shared-g`, from `main`.

## The module

- `packages/factory/src/shared/github.ts` is the factory's one `gh` boundary:
  - `gh(args: readonly string[]): string` — `execFileSync` with an argument array; stdout as text,
    a non-zero exit throws with gh's stderr in the message.
  - `api<T>(path): T[]` — `gh api --paginate --slurp`, the pages flattened into one list; a
    single-object endpoint arrives as one entry.
  - `jsonLines<T>(raw)`, `parseJson<T>(raw)` — the two JSON readers.
  - `issueComments(repo, number)` — the paginated jq read, oldest first.
- `GH_MAX_BUFFER = 256 * 1024 * 1024` lives here, next to `gh`. `common.ts`'s `SH_MAX_BUFFER` is
  `sh`'s own and unchanged: this ticket did not touch `common.ts`.
- `intake/gh.ts` now holds only `optionalIssueNumber` (env parsing for the dispatch's `ISSUE_NUMBER`);
  it exports no `gh` and no `api` any more.
- The intake modules import the shared module: `issues.ts` (`api`, `gh`, `parseJson`), `writes.ts`
  (`gh`), `triage.ts` (`gh`); `split.ts` needs only `optionalIssueNumber`.

## What changed in behaviour

- `api` and `issueComments` used to interpolate their path and jq expression into a shell string
  through `sh`; they now hand `gh` an argument array. A repo, path, branch or jq expression with
  `&`, `$`, quotes or backticks reaches gh literally, so none of these callers needs `shellArg`.
- The paging flatten and the buffer size are unchanged, and `--slurp` still cannot be combined with
  `--jq`: a read that needs jq uses `jsonLines(gh([…]))`, as `issueComments` does.

## The test pattern

- `packages/factory/test/github.test.ts` puts a fake `gh` first on `PATH`. It records its argument
  array, one per line, in `GH_ARGS_FILE`, prints `GH_STDOUT`, and exits with `GH_EXIT` (writing
  `gh: no such issue` to stderr when non-zero). A later ticket that moves a shell-string `gh` call
  onto `gh(args)` can assert both the argument array and the parsed output with the same fixture.

## Remaining shell-string `gh` callers

- `dispatch/dispatch.ts`, `fix/decide.ts`, `implement/implement.ts`, `maintain/run-*.ts`,
  `merge/merge.ts`, `report/report.ts`, `retro/collect.ts`, `retro/retro.ts`, `review/gate.ts` and
  `review/review.ts` still call `gh` through `sh`/`safeSh`/`execSync`. #131 leaves them for later
  tickets, one script at a time; the target is `gh(args)`, which drops their `shellArg` use.

Read for: any gh read/write, paging, error or buffer change; moving a shell-string gh call onto the
shared module.
