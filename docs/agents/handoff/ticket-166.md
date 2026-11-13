# Ticket #166 (overlap check) — extension points and gotchas

Branch `agent/issue-166-dispatcher-and-architecture-proposal-intake-skip-t`, from `main` after
#132.

The dispatcher and the weekly architecture pass now drop work that repeats a module another ticket
or pull request already holds. Both checks are deterministic path matching, no model call.

## The matcher (`packages/factory/src/shared/targets.ts`)

- `targetPathsIn(text)` reads repo paths from a title or body: every token with a source extension,
  plus a backticked directory of at least four segments whose first segment is one of `ROOT_DIRS`
  (`apps`, `packages`, `docs`, `scripts`, `monitoring`, `patches`, `.github`). URLs, versions,
  hashes and command flags are skipped; a package root (`packages/factory`) or a broad folder
  (`.github/workflows`) is not a module, or one sentence about protected paths would claim every
  ticket in the package. Add a top-level folder to `ROOT_DIRS` when a ticket starts naming directories
  under it.
- `shareModule(a, b)` compares two path lists. Two paths match when one is a segment-suffix of the
  other (`shared/runs.ts` ↔ `packages/factory/src/shared/runs.ts`), when a directory of at least
  four segments is a prefix of a file path (`apps/server/src/room`), or when a one-segment path
  names a non-generic stem (`turn-clock.ts`). Generic stems (`index`, `test`, `utils`, `config`, …)
  never match bare; keep that list for any new very common file name.
- `SHARED_FILES` (`docs/agents/handoff/INDEX.md`, `docs/agents/factory-log.md`, `pnpm-lock.yaml`)
  is skipped by both readers: every ticket touches them, so a changed or named shared file is not a
  claim on a module. Add a file here when tickets start colliding on a ledger they all edit.
- `branchNamesTarget(branch, path)` matches the last three path segments against the branch slug
  with hyphens (`src-dispatch-frontier` when the title names the full path), or the last two when
  the directory and the stem are both specific (`room-turn-clock` yes; `src-index` and
  `shared-runs` no, they name half the repo). Only the bare non-generic stem matches a one-segment
  path. It is only used for open pull request branches.

## The shared labels (`packages/factory/src/shared/labels.ts`)

- `WORK_LABELS` is the `ReadonlySet` of the four ticket labels; `READY_LABEL` is the dispatch label;
  `isTicketWork(issue)` is the one "a work label and no sub-issues" test both intakes use. Keep the
  dispatcher's claims and the proposal dedupe on the same definition.

## Dispatcher (`packages/factory/src/dispatch/`)

- `IssueFacts` grew `body`; `OpenPull` extends `PullFacts` with `number`, `branch` and `files`.
  `frontierOf(issues, pulls, busy, openWork)` takes every open issue as a fourth argument (defaults
  to `issues`, which is why the pure tests keep working). `frontierOf` narrows `openWork` itself: a
  claim is a ticket-shaped issue labelled `ready-for-agent` or `agent:in-progress`, and the later
  duplicate is skipped with `overlaps #N (same target module)`. A stalled ticket (`agent:blocked`,
  `ready-for-human`) claims nothing — the dispatcher will not pick it up by itself, so it would
  stall a newer ticket indefinitely and no note would say why.
- The skip order is unchanged until the open-pull test: an open pull request that closes the issue
  is still reported first; an overlapping pull is `overlaps open pull request #N (url)` and carries
  `blockingPull`. `overlapNote(pull)` returns the hidden marker
  `<!-- factory-overlap:#N -->` and the note body naming the pull number.
- `dispatch.ts` now reads every open issue once (`openIssues`), derives candidates from the
  `ready-for-agent` ones and passes every open issue as the claims. `openIssues` goes through the
  shared paginated `api` (`gh api --paginate --slurp`), so a repo past one 100-issue page still
  sees the rest. `openPulls` is one
  `gh pr list --state open --json number,url,body,headRefName,files` call, not one `/files` request
  per pull.
- Notes are posted outside the dry run, after the skipped list is printed and before the budget
  branch, one per pull number: an already-present marker is the dedupe. A dry run still only prints
  the reason, which already carries the pull number. `noteOverlaps` takes its `skipped` list,
  `readComments` and `post` as dependencies, so `test/dispatch.test.ts` pins the dedupe without a
  `gh` call; `dispatch.ts` supplies the gh commands.
- `comments()` is reused for the note dedupe; it is a paginated `/issues/{n}/comments` read.

## Architecture pass (`packages/factory/src/maintain/`)

- `TrackedWork` is `{number, title, paths}`. `issueWork(issue)` always keeps the title (so the old
  title dedupe still sees every issue), but reads module paths only for a ticket: no sub-issues and
  one of `ready-for-agent`, `agent:in-progress`, `agent:blocked`, `ready-for-human`. A spec or a
  report names a whole area, not a module.
- `pullWork(pull)` combines the pull's title/body paths with its changed files. `trackedBy` matches
  a proposal on normalized title or `shareModule`; `newProposals` filters on it.
- `run-architecture.ts` reads the open issues and the last 30 days of closed issues through the
  shared paginated `api` (`repos/<repo>/issues?state=…&since=<iso>`), and the open pull requests
  through `gh pr list --json files`, then drops a proposal before opening any issue. The closed
  window is `since = now - RECENT_CLOSED_DAYS`: closing bumps `updated_at`, so the issue stays in
  it. `gh issue list --limit` is gone — it silently drops everything past the limit, and a dropped
  issue is a duplicate proposal. The prompt now says the script does this.
- The REST issue carries `labels` as `{name}[]`, the sub-issue count as `sub_issues_summary.total`
  and a pull request as `pull_request` (filtered out). `gh pr list --json files` is an array of
  `{path, …}`, so the pull reader maps `file.path`.
- `RECENT_CLOSED_DAYS` is 30; it is the window in which a closed issue still claims its module.

## Tests

- `test/targets.test.ts` pins path extraction, shared-file skipping, suffix/directory/bare-stem
  matching and the branch-slug specificity rules (`room-turn-clock` matches; `src-index` and
  `shared-runs` do not).
- `test/frontier.test.ts` pins the changed-file and branch overlap (with `blockingPull.number`), the
  same-module duplicate (only one starts), disjoint modules running together, the open-work claim,
  that a stalled ticket claims nothing, and `overlapNote`'s marker and pull number.
- `test/dispatch.test.ts` pins the paginated `openIssues` read (pull requests filtered, `gh api
  --paginate --slurp`), `openPulls`' `headRefName`/`files[].path` mapping and `noteOverlaps`' marker
  dedupe with fake `readComments`/`post`.
- `test/proposals.test.ts` pins `issueWork`/`pullWork` path extraction and that `newProposals` drops a
  proposal whose file an open issue body or an open pull request changed file names.

Read for: any dispatcher frontier, issue-target path, pull-overlap note or architecture-proposal
dedupe change.
