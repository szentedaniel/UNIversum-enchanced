# Ticket #166 (overlap check) — extension points and gotchas

Branch `agent/issue-166-dispatcher-and-architecture-proposal-intake-skip-t`, from `main` after
#132.

The dispatcher and the weekly architecture pass now drop work that repeats a module another ticket
or pull request already holds. Both checks are deterministic path matching, no model call.

## The matcher (`packages/factory/src/shared/targets.ts`)

- `targetPathsIn(text)` reads repo paths from a title or body: every token with a source extension,
  plus a backticked directory of at least four segments whose first segment is one of `ROOTS`
  (`apps`, `packages`, `docs`, `scripts`, `monitoring`, `patches`, `.github`). URLs, versions,
  hashes and command flags are skipped; a package root (`packages/factory`) or a broad folder
  (`.github/workflows`) is not a module, or one sentence about protected paths would claim every
  ticket in the package. Add a top-level folder to `ROOTS` when a ticket starts naming directories
  under it.
- `shareModule(a, b)` compares two path lists. Two paths match when one is a segment-suffix of the
  other (`shared/runs.ts` ↔ `packages/factory/src/shared/runs.ts`), when a directory of at least
  four segments is a prefix of a file path (`apps/server/src/room`), or when a one-segment path
  names a non-generic stem (`turn-clock.ts`). Generic stems (`index`, `test`, `utils`, `config`, …)
  never match bare; keep that list for any new very common file name.
- `branchNamesTarget(branch, path)` matches the last two or three path segments against the branch
  slug with hyphens, so `shared/runs.ts` finds `…-shared-runs-ts-…`. It is only used for open pull
  request branches.

## Dispatcher (`packages/factory/src/dispatch/`)

- `IssueFacts` grew `body`; `OpenPull` extends `PullFacts` with `number`, `branch` and `files`.
  `frontierOf(issues, pulls, busy, openWork)` takes the open ticket-shaped issues as a fourth
  argument (defaults to `issues`, which is why the pure tests keep working). `openWork` is what
  makes an older ticket or an `agent:in-progress` issue claim its module; the later duplicate is
  skipped with `overlaps #N (same target module)`.
- The skip order is unchanged until the open-pull test: an open pull request that closes the issue
  is still reported first; an overlapping pull is `overlaps open pull request #N (url)` and carries
  `blockingPull`. `overlapNote(pull)` returns the hidden marker
  `<!-- factory-overlap:#N -->` and the note body naming the pull number.
- `dispatch.ts` now reads every open issue once (`openIssues`), derives candidates from the
  `ready-for-agent` ones and the claims from the ticket-labelled, non-spec ones. `openPulls` is one
  `gh pr list --state open --json number,url,body,headRefName,files` call, not one `/files` request
  per pull.
- Notes are posted outside the dry run, after the skipped list is printed and before the budget
  branch, one per pull number: an already-present marker is the dedupe. A dry run still only prints
  the reason, which already carries the pull number.
- `comments()` is reused for the note dedupe; it is a paginated `/issues/{n}/comments` read.

## Architecture pass (`packages/factory/src/maintain/`)

- `TrackedWork` is `{number, title, paths}`. `issueWork(issue)` always keeps the title (so the old
  title dedupe still sees every issue), but reads module paths only for a ticket: no sub-issues and
  one of `ready-for-agent`, `agent:in-progress`, `agent:blocked`, `ready-for-human`. A spec or a
  report names a whole area, not a module.
- `pullWork(pull)` combines the pull's title/body paths with its changed files. `trackedBy` matches
  a proposal on normalized title or `shareModule`; `newProposals` filters on it.
- `run-architecture.ts` reads open issues, the last 30 days of closed issues
  (`closed:>=YYYY-MM-DD sort:updated-desc`) and open pull requests, all through `gh issue list`/`gh
  pr list`, then drops a proposal before opening any issue. The prompt now says the script does this.
- `gh issue list --json subIssues` is an object (`{nodes, totalCount}`), not an array; the script
  reads `subIssuesSummary.total` instead. `gh pr list --json files` is an array of `{path, …}`, so
  the pull reader maps `file.path`.
- `RECENT_CLOSED_DAYS` is 30; it is the window in which a closed issue still claims its module.

## Tests

- `test/targets.test.ts` pins path extraction, suffix/directory/bare-stem matching and branch slugs.
- `test/frontier.test.ts` pins the changed-file and branch overlap (with `blockingPull.number`), the
  same-module duplicate (only one starts), disjoint modules running together, the open-work claim
  and `overlapNote`'s marker and pull number.
- `test/proposals.test.ts` pins `issueWork`/`pullWork` path extraction and that `newProposals` drops a
  proposal whose file an open issue body or an open pull request changed file names.

Read for: any dispatcher frontier, issue-target path, pull-overlap note or architecture-proposal
dedupe change.
