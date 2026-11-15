# The software factory

The factory builds this repo's tickets on GitHub Actions: **omp** (DeepSeek V4.1 Flash via
OpenCode Go, max effort) does the token-heavy work — implementing tickets, fixing CI — and **Claude
Code** (the owner's Pro subscription) does the judgement work: triage, specs, review, retro. The
owner gives direction, approves specs and merges only what the gates escalate. [Spec
#85](https://github.com/szentedaniel/UNIversum-enchanced/issues/85) holds the decisions; this page
holds how to run it.

Runners are GitHub-hosted `ubuntu-latest` on the free private plan (2000 Actions minutes a month,
shared with CI), so the factory counts minutes and the agents run the **fast checks only** — fmt,
lint, typecheck, vitest. Playwright and `docker compose build` run once, in CI, on the pull request.

## Where the code is

- `packages/factory/` (`@universum/factory`) — one folder per step: `src/<step>/<step>.ts` plus the
  `prompt.md` it hands the agent. The prompts are the contract with the agent; the TypeScript around
  them only starts the run, checks its result and leaves the report for the workflow. The dispatch
  step runs no agent: `src/dispatch/` decides which issues to start.
- Scripts run with plain `node` (Node 26 strips the types, as `pnpm run check:commits` does). There is
  no build step and no `tsx`.
- `.github/workflows/factory-*.yml` are thin shells: labels, branch, push, PR. Anything with a branch
  in it belongs in `packages/factory` with a vitest test.
- The agents run with `noSandbox()`: the runner is already an ephemeral VM.

## Schedules

GitHub starts scheduled runs late on this repository, by an hour to nine hours, and sometimes drops a
run altogether, worst at the top of the hour. So the factory schedules one thing: `factory-tick.yml`.
Its cron runs every ten minutes, off the top of the hour, but only as the safety net. Unless it is a
dry run, a started run first asks the runs API whether a newer `factory-tick.yml` run is queued or
running; if one is, it exits without ticking. Only a newer run counts: the group holds one running
and one pending run, and a newer pending run replaces the older one, so an older run the API still
lists as queued is one that already ran or lost its slot. A scheduled (cron) run is only the safety
net and a dry run ticks once without relaying, so neither counts. Otherwise the run becomes the
heartbeat: it calls the tick every ten minutes for about 5.5 hours, then dispatches its successor
with `gh workflow run factory-tick.yml --ref main` and exits. A tick that overruns its ten minutes
skips the slots it missed instead of ticking back to back. The successor waits in the `factory-tick`
group behind the old run, so exactly one heartbeat is live and the chain relays itself; a dry run
waits in `factory-tick-dry-run`, so it can neither replace the pending successor nor pass for a
heartbeat. The cron only starts a new chain after a dropped relay. Every `gh` call is capped at
`GH_CALL_TIMEOUT_MS` (a minute), so a hung call fails like any other error and cannot carry the loop
past its hand-over without a relay.
A tick dispatches every nightly or weekly job that is due and has not run since it fell due
(`packages/factory/src/schedule/due.ts`). The schedule is Budapest wall time, so a DST switch needs no
second slot:

| Job          | Workflow                                            | Due          | Latest start |
| ------------ | --------------------------------------------------- | ------------ | ------------ |
| intake       | `factory-intake.yml`                                | daily 01:07  | 07:00        |
| review queue | `factory-review.yml` (empty `pr`: drains the queue) | daily 02:23  | 07:00        |
| retro        | `factory-retro.yml`                                 | daily 04:41  | 07:00        |
| maintain     | `factory-maintain.yml`                              | Sunday 03:19 | Sunday 07:00 |
| report       | `factory-report.yml`                                | Monday 06:09 | Monday 23:59 |

Every tick also starts `factory-dispatch.yml` unless one of its runs is queued or in progress: the
heartbeat is the dispatcher's regular trigger, so a finished review, a pull request leaving the gate
or an unblocked issue fills a free implementer slot within ten minutes instead of waiting for an event.
The dispatcher is no nightly job: it is not in the tick's schedule, its start carries no `scheduled`
input and its run gets no `(factory tick)` marker, so a dispatch the tick starts can neither stand in
for a due job nor suppress one. A live dispatch run is left alone, and a failed read of its runs
starts none: the error is collected and the next tick tries again.

Every tick ends with the stuck-pull-request sweep (`packages/factory/src/schedule/sweep.ts`): it
nudges an open factory pull request GitHub left with no CI run, no review or no merge decision, and
hands one a nudge did not help to a person. It runs after the due jobs and the dispatcher, and a
failed sweep is collected like any other error, so it cannot hold either back. One open-pull list,
one page of the newest workflow runs and one detail read per open factory pull request — plus the
comment and the write a nudge needs — keep its API cost small. The rules are under
[The stuck-pull-request sweep](#the-stuck-pull-request-sweep).

The latest start keeps the Claude jobs inside the 01:00–07:00 night window: a tick at or after it does
not start a missed job; the next day's due time does, so a missed night waits for the next one. A tick
dispatches a due job with `scheduled=true` and that workflow's run name carries `(factory tick)`; only
those runs mark a job as done, so a manual, dry or per-pull-request run never suppresses the scheduled
one, while a failed tick dispatch still counts and is not retried in a loop (failures stay visible in
Actions and the weekly report). A failed tick inside the heartbeat does not end it: the error is
logged and collected, the next tick still runs, and the heartbeat relays its successor before the run
turns red. A failed relay is retried three times, a minute apart; when every attempt fails, the run
turns red and the next cron run starts a new chain. A dry run ticks once and starts neither the
dispatcher nor a successor. A second run must still be harmless: intake and the review queue find
nothing left, the dispatcher skips issues a run holds, the retro stops at the day's log entry, and
the report edits the week's issue. A run can always be started by hand (`gh workflow run <file>`),
and `factory-dispatch.yml` keeps its own hourly cron as a backstop for a heartbeat chain that has
stopped.

## Labels

| Label                   | Means                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `ready-for-agent`       | Specified enough for an AFK agent; the dispatcher's frontier is these         |
| `ready-for-human`       | The owner implements it (an issue) or merges it (a pull request)              |
| `agent:in-progress`     | A run holds this issue; removed on every exit path                            |
| `agent:review`          | On a pull request: the review step may look at it                             |
| `agent:blocked`         | A run failed or asked a question; the issue or pull request waits for a human |
| `risk:low`, `risk:high` | The reviewer's merge-danger verdict (two-way door, local blast radius)        |
| `spec:proposed`         | A spec draft waits for the owner's `spec:approved`                            |
| `spec:approved`         | The owner approved the spec; the next step splits it into tickets             |
| `factory`               | An issue about the factory itself; only the owner merges these                |
| `factory:report`        | The weekly health issue                                                       |

The path a ticket takes:

```text
ready-for-agent ──dispatch──▸ agent:in-progress ──PR opened──▸ agent:review (on the PR)
                                        │                              │
                                        └──any failure──▸ agent:blocked│
                                                                       ▼
                   changes requested ──▸ factory-fix (2 rounds) ──▸ CI ──▸ factory-merge
                   pass + risk:low ────────────────────────────────────▸ factory-merge ──▸ merged
agent:blocked ──re-dispatch──▸ agent:in-progress
```

`agent:review` is set by the implement run once its pull request exists; the review step swaps it for
`risk:low` or `risk:high`, the merge gate merges what the gates allow, and the fix loop sends a
failing pull request back to omp at most twice. The weekly `factory:report` issue is described under
[The weekly report](#the-weekly-report).

## Intake

The owner files a one-line idea as an issue; intake turns it into work the factory can start.
`factory-intake.yml` is dispatched by the tick every night at 01:07 Budapest and can be dispatched by
hand at any time — outside the night window too:

```bash
gh workflow run factory-intake.yml                                   # every waiting issue
gh workflow run factory-intake.yml -f issue=93                       # one issue, whatever its labels
gh workflow run factory-intake.yml -f dry_run=true                   # print the decisions and writes
```

The tick only dispatches it inside the night window, and a tick-dispatched run that starts after the
window does nothing (the script re-checks it), so a delayed start spends no daytime Pro usage. One run
handles at most `FACTORY_INTAKE_MAX` issues per step (repository variable; default 3), oldest first.

**Triage** classifies each issue into exactly one outcome, with one comment and a label:

| Outcome     | Comment                                                                                   | Labels                                    |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| bug / small | the **Implementation context** comment: files, seams, hazards, checks                     | `ready-for-agent`, `needs-triage` removed |
| unclear     | concrete questions, numbered                                                              | `needs-info`                              |
| feature     | a spec draft: Problem, Solution, User stories, Decisions, Testing Decisions, Out of scope | `spec:proposed`                           |

The issues it looks at are the open `needs-triage` ones and the open issues with no label at all that
the owner, a member or a collaborator filed; sub-issues and pull requests are never triaged. The
`agent:in-progress` label marks the factory's own work, so it excludes an issue just like any other
label. `-f issue=<n>` is the override: that open issue is triaged whatever its labels.

**Split** turns each open `spec:approved` issue into tickets: the approved spec — the newest comment
between `<!-- factory-spec -->` and `<!-- /factory-spec -->`, else the issue body — is written into
the parent's body, and the children are created with

- `Parent: #<n>` as their first line and the native sub-issue link,
- their blocking edges (the plan's `blockedBy` indices, acyclic and in range — validated before the
  first write),
- an Implementation context comment each, and `ready-for-agent`.

The parent then swaps `spec:approved` for `factory`. A spec that already has sub-issues is never
split again, so a failed run cannot duplicate its tickets; a partially split spec keeps
`spec:approved` as the owner's clue.

Claude only reads. It runs on a checkout of `main` (`claudeAgent`, pinned Claude Code and plugin as in
the review step) and returns one structured `<triage>` or `<split>` block; the script in
`packages/factory/src/intake/` performs every comment, label, issue and edge with `AGENT_PAT`. A run
that leaves the checkout changed fails, so an issue's text cannot steer a write. A label made with
the PAT starts no workflow here (the dispatcher listens to pushes, runs and a cron), so the workflow
runs `factory-dispatch.yml` itself once something became `ready-for-agent`.

A failed step leaves the issue's label in place, so the next night retries it; the red Actions run is
the alarm. The two steps are independent — a triage failure still lets an approved spec split. The
same decisions against the live repo, read-only:

```bash
DRY_RUN=1 GH_REPO=<owner>/<repo> ISSUE_NUMBER=<n> node packages/factory/src/intake/triage.ts
```

## Dispatch

`factory-dispatch.yml` picks the frontier: open `ready-for-agent` issues that no run holds
(`agent:in-progress`), no human owns (`agent:blocked`, `ready-for-human`), no open blocker holds back
(GitHub's native dependencies), that are not a spec (sub-issues), that no open pull request already
closes, and whose target module no open work already holds. A ticket's target modules are the paths
its body names, usually its `## Files` list; it overlaps an open pull request when one of those paths
matches the pull's changed files, a three-segment module path in its branch slug, or a two-segment
pair whose directory and file name are both specific. It overlaps an older open ticket when both name
the same module, but only work an agent holds or will start (`ready-for-agent`, `agent:in-progress`)
holds a module: a stalled ticket (`agent:blocked`, `ready-for-human`) claims nothing, so it cannot
stall a newer ticket indefinitely.

The shared files are not targets: naming one is no claim on a module, and a pull request whose
changed files are all shared files holds nothing, however its branch is named. Each one only grows a
line or an entry, so two tickets that both append to it share no code:

- `apps/web/messages/*.json` — a new string is a new key in hu, en and de.
- `apps/web/src/text.ts` — the message wiring: one map entry per new message.
- `apps/e2e/tests/helpers.ts` — the one home for shared e2e steps: a ticket adds its own.
- `GLOSSARY.md` — a new domain noun adds its entry.
- `docs/agents/handoff/*` — the ledger: one `ticket-<n>.md` and one `INDEX.md` line per ticket.
- `docs/agents/factory-log.md` — one line per day.
- `pnpm-workspace.yaml` — a new package adds one entry.
- `pnpm-lock.yaml` — any dependency change rewrites it.

The list is `SHARED_FILES` in `packages/factory/src/shared/targets.ts`. An overlapping ticket keeps
`ready-for-agent`, gets one note naming the pull request number (deduped by a hidden marker), and
starts once the pull request merges or closes. The match is deterministic
(`packages/factory/src/shared/targets.ts`), with no model call.

Oldest first — there is no priority label yet (`PRIORITY_LABELS` in
`packages/factory/src/dispatch/frontier.ts` is the seam) — and at most `FACTORY_MAX_PARALLEL`
implementers (default 2) run at once. An issue whose run is already queued counts as running, even
before its `agent:in-progress` label lands.

It runs when an implementation run finishes (a slot frees), on every push to `main` (a merge unblocks
dependants), every heartbeat tick and hourly as a backstop (the repository is public, so Actions
minutes are free); `concurrency: factory-dispatch` makes two triggers take turns. The tick starts a
dispatch only when none is queued or running, so the ten-minute trigger keeps at most one dispatch on
its way. A queued dispatch waits for the running one, which has already seen the implement run it
started, and the frontier counts a queued implement run as running, so a tick-started dispatch cannot
start the same issue an event-started one already did. Each dispatch is
`gh workflow run factory-implement.yml -f issue=<n>` with `AGENT_PAT`.

Minutes come from the jobs API: every job of every `factory-*.yml` run created this calendar month
(UTC), rounded up per job the way GitHub bills. `FACTORY_MONTHLY_MINUTES` (default 1400) caps them; the repository is public, so the repo variable is
`off`: no cap, and no counting either (counting costs one API call per factory run of the month on every
dispatch, which exhausted the token's hourly rate limit).
When they are spent the dispatcher posts one comment — deduped by a hidden marker — on the newest open
`factory:report` issue, opening one when there is none, and dispatches nothing until the month rolls
over. Both limits are repository variables of the same names; unset or misspelt values keep the
defaults.

A dry run prints the frontier with each skipped issue's reason, the running count, the budget and
what it would dispatch, and writes nothing:

```bash
gh workflow run factory-dispatch.yml -f dry_run=true
gh run watch "$(gh run list --workflow factory-dispatch.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The same plan against the live repo, from a checkout (needs `gh` logged in): `DRY_RUN=1
GH_REPO=<owner>/<repo> node packages/factory/src/dispatch/dispatch.ts`.

## Dispatching a run by hand

The dispatcher starts runs on its own; dispatch one by hand to retry an issue it passes over, or to
start one before its next event:

```bash
gh workflow run factory-implement.yml -f issue=93
gh run watch "$(gh run list --workflow factory-implement.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

What the run does:

1. **Refuses** (with a comment, and no branch) when the issue has sub-issues — that is a spec, not a
   ticket — or when an open pull request already says `Closes #<n>`. Being a _sub-issue_ of a spec is
   what every ticket looks like, so only sub-issues block a run.
2. Takes the issue's `agent:in-progress`, cuts `agent/issue-<n>-<slug>` from `main` and installs the
   workspace (plus Bun and omp).
3. Runs `node packages/factory/src/implement/implement.ts`: `sandcastle.run()` with the omp provider,
   the issue and its comments as context, up to five iterations.
4. Fails, and marks the issue `agent:blocked` with the reason and the run's link, when the agent made
   **no commit** or wrote no report.
5. Pushes the branch with `AGENT_PAT`. What follows is the report's own `STATUS:`:
   - `DONE` opens the pull request (`Closes #<n>`, the report as its body) and labels it
     `agent:review`; CI then runs on it like on any other PR.
   - `BLOCKED` opens no pull request: the report (its `## Question`) is commented on the issue, which
     gets `agent:blocked` and `ready-for-human`, and the branch keeps the work in progress.

A run is 45 minutes at most and one runs per issue at a time (`concurrency`). Re-dispatch to retry:
the branch is force-pushed and the issue leaves `agent:blocked` and `ready-for-human`.

`AGENT_PAT` is the reason a pushed branch runs CI at all: a push or a label made with the default
`GITHUB_TOKEN` triggers no workflow. It has Workflows read/write, so the factory can build tickets that
change `.github/workflows/`; `.github/` stays a protected path, so the merge gate never auto-merges
them and the owner merges those pull requests.

## Reviewing a pull request

`factory-review.yml` runs when a pull request gets `agent:review`, when the owner dispatches it by
hand (`gh workflow run factory-review.yml -f pr=95`), and each night when the tick dispatches it with
no `pr` at 02:23 Budapest.

1. **Queues** instead of reviewing when the Budapest clock is outside 01:00–07:00 and
   `FACTORY_DAY_REVIEWS` (a repository variable, default 2) daytime reviews already ran today. The
   run exits 0 and leaves `agent:review` in place; the tick dispatches one review per pull request
   still carrying the label, so a queued review happens at night. The count comes from the summary
   comments themselves — they open with `<!-- factory-review -->` — per Budapest calendar day, and
   night reviews do not spend the daytime quota. The gate reads the queue first: a `pull_request`
   event for another label does nothing, and a manual dispatch reviews only a pull request that is
   labelled or whose newest factory comment is the failed-review handoff (step 5). That recovery
   runs at once rather than queueing, because the owner is asking for a review the failed run lost.
2. Checks out the pull request's branch, installs Claude Code 2.1.311 and the
   `mattpocock-skills@claude-plugins-official` plugin, and **fails the step unless the plugin is
   1.3.1**: that version is the pin for the `code-review` skill, so a renamed skill fails loudly
   instead of reviewing with nothing.
3. Runs `node packages/factory/src/review/review.ts`: one Claude Code session on `claude-sonnet-5-5`
   invokes `/mattpocock-skills:code-review` against `origin/main`, with the pull request's linked
   issue and its parent spec as the Spec axis. The skill reports the Standards and Spec axes side by
   side; the same session then commits the fixes it is sure of (conventional commits, fast checks
   green) and emits `<review>` structured output — `verdict`, the `findings` it did **not** fix
   with a `blocking` or `advisory` severity each, and `mergeDanger`. A missing or invalid block gets
   one more turn in that same session, with the validation error in the prompt; if the retried reply
   still carries no `mergeDanger`, the step posts its verdict and findings anyway, labels the pull
   request `risk:high`, and the summary says the merge danger was not rated.
4. Pushes the reviewer's commits with `AGENT_PAT` (a plain push, never forced), posts one summary
   comment, and swaps `agent:review` for `risk:low` (only a two-way door with a local blast radius)
   or `risk:high`. A `changes-requested` verdict dispatches the fix loop
   (`gh workflow run factory-fix.yml -f pr=<n> -f reason=review`); a pass leaves the merge gate to
   decide and clears a stale `ready-for-human`.
5. When the review step fails even after its second turn, the workflow re-dispatches itself once with
   `retry: true`, leaving `agent:review` so the re-run is reviewable. Only a failure with no retry
   left comments the reason, removes `agent:review` and adds `ready-for-human`: the tick must not
   retry a broken review forever. The comment opens with `<!-- factory-review:failed -->`, so a
   manual `gh workflow run factory-review.yml -f pr=<n>` reviews that pull request again without a
   relabel; a pull request held for another reason (a spent fix budget, a merge-gate refusal) is left
   alone.

Claude runs with `--permission-mode bypassPermissions` (`claudeAgent` in `src/shared/agents.ts`):
Sandcastle's `noSandbox()` provider reports no sandbox, so it passes no permission flag, and
`claude -p` would deny every edit and Bash call. The runner is an ephemeral VM.

**Findings carry a severity.** A `blocking` finding is a bug, a broken acceptance criterion, a
standards breach with a real cost or a security issue. An `advisory` finding is a judgement call, an
optional follow-up, a scope note, or a test that could be stronger: the prompt asks for
`changes-requested` only when at least one finding is blocking. A finding with no severity — an old
prompt, a malformed reply — counts as blocking, so today's path is the fallback. A
`changes-requested` review whose findings are all advisory is read as a pass by the fix loop and the
merge gate: no fix round runs for a judgement call, and the gate's usual rules decide the pull
request. The findings are not lost: a merge with advisory findings files one `needs-triage` issue
naming the pull request and listing them, and the nightly intake decides whether they become a ticket
or are closed.

**An additive protocol change is a two-way door.** Adding to the wire while leaving everything
already on it alone — a new optional field, a new message or intent type, a new Rejection code, or a
new chat catalogue id — is a change old clients ignore and a clean revert until a client ships code
that depends on it, so the reviewer rates it `two-way` and gives its blast radius as it is (a
protocol change usually spans packages, so `wide`). These stay one-way doors: renaming or removing
anything on the wire, making an optional field required, changing a field's type or meaning, reusing
a retired id, and changing stored state outside the migration path. The gate needs no new rule:
`risk:high` with a two-way rating already merges outside a protected path (step 3 below), and
`packages/protocol/src/` is not one.

## Merging and fixing

Two steps finish a pull request: `factory-merge.yml` merges what the gates allow, and
`factory-fix.yml` sends a failing one back to omp.

### The merge gate

`factory-merge.yml` runs when a pull request's CI finishes **successfully**, when a review finishes
(whichever is last decides), hourly as a backstop, and by hand. A failed CI run is the fix loop's. The
gate code runs from a **checkout of `main`**, never the pull request's copy: a PR that edits
`packages/factory/` must not decide its own merge.

It merges with a merge commit only when every gate holds ([spec #85, Decision
5](https://github.com/szentedaniel/UNIversum-enchanced/issues/85)):

1. The `CI` workflow concluded `success` on the pull request's head sha (a re-run that passed counts).
2. The newest `<!-- factory-review -->` comment says pass — or asks for changes only over advisory
   findings — and was posted **after** the head commit; a push after the review queues `agent:review`
   again, so a fix commit is reviewed before merging.
3. The pull request carries `risk:low` (a two-way door with a local blast radius), or `risk:high` whose
   review names a **two-way** door — an additive protocol change is one, a breaking wire change is
   not: a wide blast radius alone does not wait for the owner once the
   review passed and CI, e2e included, is green. A one-way door, or a `risk:high` whose merge danger
   the gate cannot read, waits for a human — except the one-way door of a mechanically checked state
   migration (below).
4. It touches no protected path: `.github/`, `packages/factory/`, `CODING_STANDARDS.md`, `AGENTS.md`,
   `CLAUDE.md`, `docs/agents/`, `docs/adr/`, `packages/rules/src/migrate.ts` and
   `packages/rules/test/fixtures/`. `docs/agents/handoff/` is the one exception: every implementer
   writes a handoff note and its `INDEX` line, so blocking those would block every ticket. The
   migration's two paths are the other: a pull request whose only protected-path changes are a
   mechanically checked state migration merges (below).
5. No `package.json` moves a dependency to another major (the first non-zero number for `0.x`).

**A state migration is the one protected path the gate may take on its own.** Every rules change that
adds state bumps `STATE_VERSION` and touches `packages/rules/src/migrate.ts` and
`packages/rules/test/fixtures/`, and the reviewer rates it a one-way door, so it would always wait for
the owner. `packages/factory/src/merge/migration.ts` reads the two sides of the diff instead, and when
it finds nothing wrong the same gates above merge the pull request:

- `STATE_VERSION` in `packages/rules/src/state.ts` is main's value plus exactly one.
- `packages/rules/src/migrate.ts` differs only by the single `MIGRATIONS` entry for main's value.
  Imports and comments may change; no existing entry, and none of the code around the entries
  (`migrate()` included), may.
- Exactly one new `packages/rules/test/fixtures/state-v<new>.json` appears, and no existing snapshot
  is edited or removed.
- `packages/rules/test/migrate.test.ts` names the new snapshot and still lists every one main had,
  so the chain still runs them all.

`migrate.test.ts` runs every stored snapshot through the chain to the current shape, so that chain
stands in for the review of the migration: its one-way door rating no longer stops the merge. The
exception covers the migration alone — a pull request that touches another protected path or the wire protocol (`packages/protocol/src/`), or whose
migration fails one of these conditions, waits for the owner with the check's reasons, which all open
with `state migration:`, and a one-way door on a pull request that is not a sound migration keeps its
refusal.

The merge is `gh pr merge --merge --subject "chore(merge): #<issue> <the ticket's title>"` (the
ticket's title, not the pull request's `Implement #N: …`; a Dependabot pull request closes no ticket,
so it names its own number and title). The issue gets a
comment naming the merge commit and is closed (`Closes #…` in the body already closed it). A merge
whose newest review left advisory findings then files one `needs-triage` issue, `Factory review
follow-ups: #<pull>`, listing them and linking the pull request; a refused merge files none. The
nightly intake triages it like any other issue. The push to `main` starts `factory-dispatch.yml` by
itself, so the next ticket is dispatched without a chain.

Green but gated → `ready-for-human` on the pull request and one comment listing every reason
("touches .github/", "one-way door: …", "dependency major: …"). A branch merely **behind main** merges
as it is: CI ran on the pull request merged into main. Only a conflict, or main changing a file the
pull request changes too (handoff notes aside), sends it to the fix loop first (`main-moved`). A
migration that main already took first (two migrations raced to the same `STATE_VERSION`, so the two
entries would share a key) is the same `main-moved` case even when the compare API's capped file list
does not name main's change; the fix loop's prompt then tells omp to renumber the migration entry, the
snapshot's file name and its import and list entry in `migrate.test.ts` onto main's next version. A pull
request that is only _waiting_ — CI still running, the review not posted yet, `agent:review` queued —
exits quietly: the next trigger decides.

Two gate runs can decide one pull request at the same moment — a CI completion and a review completion
that land together. Both read the same facts, so both may try to merge or both may refuse. A merge
GitHub answers with `Merge already in progress (mergePullRequest)` is not a failure: the gate re-reads
the pull request, and one that reads `MERGED` or carries an auto-merge request (queued to merge) is
left to the run that has it, with no waiting comment, ticket comment, close or follow-up issue. Before
the gate posts a waiting comment it re-reads the pull request's comments, and skips the post when the
newest `<!-- factory-merge -->` comment already carries the same body; the `ready-for-human` label
still goes on, because adding a label twice is a no-op and the label is what holds the pull request.
The workflow's concurrency group is what serialises the two runs; the re-read and the dedupe keep an
overlap from leaving two comments or a false "could not decide" behind.

A `gh` read GitHub refuses for a rate limit — a 403 or 429 saying "rate limit", or a GraphQL error
(`pr view`, `issue view`) naming one — is waited out and retried, as when many pull requests merge at
once. The wait the refusal names (`retry-after`, or the `x-ratelimit-reset` instant from the headers
the reads ask for with `--include`) wins; otherwise the retries take 30 s, 2 min and 5 min. The whole
run shares one 10-minute wait budget (the job times out at 15): when a wait would pass it, the step
exits green and comments nothing, so the pull request waits for the next merge-gate run instead of the
owner reading "could not decide". A write is never retried — a refused write did not apply, and
retrying a merge or a second comment can leave half a finished state behind — so a refused write also
exits green for a later run. Every other failure still fails the step and reaches that escalation. The
hourly `schedule` re-dispatches the gate for every open factory or Dependabot pull request, so a
deferred one is decided without another CI or review event.

A dry run prints the decision and writes nothing:

```bash
gh workflow run factory-merge.yml -f pr=95 -f dry_run=true
DRY_RUN=1 GH_REPO=<owner>/<repo> PR_NUMBER=95 node packages/factory/src/merge/merge.ts
```

### The fix loop

`factory-fix.yml` runs when a pull request's CI concludes `failure`, when the review asks for
changes, and when the merge gate needs main merged in (`needsMain`). omp gets one prompt
(`src/fix/prompt.md`) with the failure: the failed jobs' log tail (`gh run view --log-failed`,
trimmed to the prompt's budget), the review's findings, or the conflict it must resolve. It commits
on the branch and the workflow pushes with `AGENT_PAT`; CI runs again and the merge gate decides.

- The rounds are counted from hidden comments on the pull request,
  `<!-- factory-fix:round N -->`, so the CI and review triggers share one budget: **two** rounds
  (`MAX_FIX_ROUNDS` in `src/fix/rounds.ts`). A spent budget posts one escalation comment
  (`<!-- factory-fix:escalated -->`), adds `agent:blocked` + `ready-for-human` and runs no agent.
  A review trigger whose newest review asks for changes only over advisory findings stands down
  instead, spent budget or not: no round, no escalation, no label, and the merge gate decides. A red
  CI run keeps its rounds and its escalation whatever the last review said.
- Merging main in is housekeeping, not a round: a conflict-free merge is git's own merge commit, and
  only a conflict reaches the agent.
- A failed run (no commit, a dirty tree, `STATUS: BLOCKED`) comments the reason and adds the same
  two labels. Re-dispatch by hand to retry; the dispatch clears both labels first.

```bash
gh workflow run factory-fix.yml -f pr=95 -f reason=review      # ci | review | main-moved
```

### The stuck-pull-request sweep

A pull request can sit for hours with nothing running on it: GitHub sometimes starts no CI run on a
new pull request, a review labelled before a green CI is not started by the later run, and a merge
gate a rate limit deferred waits for the next trigger. The tick's sweep
(`packages/factory/src/schedule/sweep.ts`) looks at every open factory pull request — an `agent/`
branch, the `factory` label or a Dependabot bump — and does one of three things, each after **30
minutes** of silence and at most **once per head commit**:

- **No CI run on the head** for 30 minutes after the head commit or the pull request's creation:
  the sweep merges `main` into the branch through the API (`POST /repos/{repo}/merges`, so the PAT's
  push starts CI). A merge that conflicts dispatches `factory-fix.yml -f reason=main-moved` instead.
- **Green CI and `agent:review`, no review run** created since CI went green: it dispatches
  `factory-review.yml -f pr=<n>`. The review gate still applies its night window and daytime quota,
  so a queued review is a run that exists and the sweep leaves it.
- **Green CI and a passing review, no `factory-merge.yml` run since the review**: it dispatches
  `factory-merge.yml -f pr=<n>`, as the hourly backstop does.

Each action opens with a hidden marker comment (`<!-- factory-sweep:<ci|review|merge>:<sha> -->`), so
the same head commit is never nudged twice. A marker older than 30 minutes whose action still has not
produced a run means the nudge did not help: the pull request gets `ready-for-human` and one comment
naming what the sweep tried (`<!-- factory-sweep:<action>:<sha>:escalated -->`). A pull request that
is closed, a human's, `agent:blocked` or already `ready-for-human` is left alone, as is one whose CI
is still running or failed (the fix loop owns it). A dry tick (`gh workflow run factory-tick.yml -f
dry_run=true`) prints what the sweep would do and writes nothing.

The sweep reads the open pull requests, one page of the newest 100 workflow runs, and one detail
read per open factory pull request (its comments and head commit); a nudge costs one comment and one
write. That is two list calls plus at most a call per open factory pull request a tick, well inside
the factory's share of the API budget.

## The nightly retro

`factory-retro.yml` is dispatched by the tick at 04:41 Budapest, inside the night window after the
review queue, and by hand; a second run of a day stops at the day's log entry (`hasLogFor`).
It reads the last 24 hours of the factory's own trail — the reviewer's summaries and the fixes it
committed, fix rounds and escalations, merge escalations, merged and blocked pull requests, red `CI`
runs with their failed jobs, and the owner's own comments on factory issues and pull requests — then
asks Claude (one session, structured output) for the problems that **recur** and the cheapest durable
fix for each. A day with no factory activity stops before the install and the Claude call.

Claude decides; `src/retro/retro.ts` writes. Each finding's `fix.kind` chooses one of:

- `issue`: a lint rule, a test or a small code change → a `ready-for-agent` ticket with the
  implementer protocol's Implementation context section.
- `standards-pr`: a change to the standards, the implementer protocol, the factory docs, an ADR or a
  step prompt → a `retro/<date>-<slug>` branch with the patch (`git apply --check` first) and a
  `ready-for-human` pull request; the owner merges the protected path.
- `workflow-pr`: a `.github/workflows/` change → a `retro/<date>-<slug>` branch with the patch and a
  `ready-for-human` pull request; the owner merges the protected path.
- `none`: no durable fix; the finding only reaches the log.

The script dedupes against the open issues and pull requests (the prompt gets them, and a title check
backs it up), and writes at most `FACTORY_RETRO_MAX` (default 3) things per run. Every day with
factory activity appends a dated entry to [`factory-log.md`](factory-log.md), committed straight to
`main` as `docs(factory): retro log YYYY-MM-DD` with `[skip ci]`; a quiet day writes one
`- Nothing new.` line and opens nothing.

```bash
gh workflow run factory-retro.yml -f dry_run=true
```

A dry run prints Claude's answer, the writes it would make, and the log entry, and writes nothing.
Locally (read-only, no Claude call): `DRY_RUN=1 OUTPUT_DIR=$(mktemp -d) node
packages/factory/src/retro/collect.ts` prints the shaped facts to stderr and writes them to
`facts.json`.

## The weekly report

`factory-report.yml` opens the owner's weekly glance, a `factory:report` issue, every Monday at 06:09
Europe/Budapest, dispatched by the tick. A repeat dispatch the same week edits the same issue; a
manual dispatch always runs, and its `dry_run` input only prints the body.

The issue is titled `Factory report: week of YYYY-MM-DD` (the Monday that started the reported week)
and opens with `<!-- factory-report:YYYY-MM-DD -->`, so a re-run in the same week edits it instead of
duplicating it. The script writes the new week's issue **before** closing the older weekly ones — the
dispatcher comments its budget notice on the newest open report issue — and leaves a `Factory report —
YYYY-MM` month issue open, because that is where the budget notice lives.

The week is the Budapest Monday-to-Monday that just ended. Its rows:

| Row                   | What it counts                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tickets merged        | Issues closed by a pull request merged in the week; a merged pull that closes no issue (Dependabot, maintenance) is not a ticket pull                                                                                                                                                                          |
| Blocked               | Open `agent:blocked` issues, plus the issues whose timeline shows the label was added during the week                                                                                                                                                                                                          |
| Fix rounds (mean)     | The highest `<!-- factory-fix:round N -->` on each merged ticket pull, averaged; `none yet` without a merged pull                                                                                                                                                                                              |
| Merges                | Auto when #87's merge gate merged it — its `Merged in <sha>.` comment on the closing issue — and human otherwise; a merged pull request carrying the gate's `<!-- factory-merge -->` escalation marker is always a person's merge (the PAT is the owner's account, so the merging user cannot tell them apart) |
| Idea → merge (median) | Issue `created_at` to the closing pull's `merged_at`, in hours under two days and days above                                                                                                                                                                                                                   |
| Minutes               | Billed factory minutes (`src/dispatch/budget.ts`) for the month to date against `FACTORY_MONTHLY_MINUTES` (default 1400), and the week's; a warning appears at 80 percent                                                                                                                                      |
| Claude runs           | Runs of `factory-review.yml`, `factory-intake.yml` and `factory-retro.yml` started in the week, split by whether the start was in the night window                                                                                                                                                             |
| omp runs              | Runs of `factory-implement.yml` and `factory-fix.yml` started in the week                                                                                                                                                                                                                                      |
| Retro changes         | Lines added to `docs/agents/factory-log.md` in the week (#90); `none yet` while the file does not exist                                                                                                                                                                                                        |

Runs are classified by their workflow **path**: the runs API's `name` is the workflow's `run-name`
(`Factory review #97`), not its `name:`, so matching names would silently count nothing.

`## Needs you` lists the open `ready-for-human` issues and pull requests and the `spec:proposed`
issues, oldest first, as links — the owner's whole queue.

The workflow uses the default `GITHUB_TOKEN` (issues write; actions, pull requests and contents read):
it writes one issue and triggers nothing. To read the current week's numbers without writing:

```bash
DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/report/report.ts
```

## Maintenance

The factory keeps the codebase healthy without being asked. The rules live in
`packages/factory/src/maintain/` (pure modules with vitests, plus the scripts the workflows run); the
prompt is `src/maintain/prompt.md`.

### Dependencies (Dependabot)

`.github/dependabot.yml` opens a weekly pull request for the pnpm workspace: minor and patch bumps
in **one grouped pull request**, a major on its own, and `github-actions` bumps weekly.
Dependabot labels its own pull requests `agent:review` (`labels:` in the config), and they then
take the same path as any factory pull request: review, CI, merge gate, and the fix loop when CI is
red. A
dependency major is `ready-for-human` by the merge gate's own rule; every `github-actions` bump
changes `.github/workflows/`, a protected path, so the owner merges those.

Three things keep it working:

- **A workflow whose actor is `dependabot[bot]` gets no Actions secrets**, not even
  `pull_request_target`. So `factory-review.yml` skips Dependabot's own label event, and the tick's
  nightly queue dispatch reviews it as the owner, with the Claude token. A Dependabot pull request is
  therefore reviewed the night after it opens. CI needs no secret (keep it that way:
  check `ci.yml` before adding one).
- **The commit check runs on the bump.** Dependabot's own subject ("Bump x from a to b") has no type
  and would be red on `check:commits`, so the config prefixes it with `build(deps)`.

A Dependabot pull request closes no issue, so the merge gate names it `chore(merge): #<pr> <title>`
(`mergeSubjectOf` in `src/merge/gates.ts`); every other factory pull request still has to close its
ticket.

### Weekly (`factory-maintain.yml`)

Dispatched by the tick every Sunday at 03:19 Budapest, inside the night window, or by hand with
`dry_run`. Three independent jobs:

- **Architecture**: Claude Code reads the hot spots (`git log`), `GLOSSARY.md`, `docs/adr/` and
  `CODING_STANDARDS.md`, consults the pinned plugin's `codebase-design` skill, and returns **at most
  two** proposals as JSON. The script opens one issue each, deduped against the open and recently
  closed issue titles and target paths, and against the open pull requests' changed files: a proposal
  that repeats a module already in flight is dropped, not filed. `ready-for-agent` only for a two-way
  door, else `ready-for-human` (the merge gate would escalate a
  one-way door anyway). The plugin also ships `improve-codebase-architecture`, but that command is
  interactive (an HTML report and a question), so the pass owns its own output contract and takes
  only the vocabulary from `codebase-design`. A manual run may lift the cap for a whole-codebase
  sweep (`gh workflow run factory-maintain.yml -f max_proposals=10`, 1–20), and keep it to some paths
  (`-f focus="apps/server packages/rules"`); proposals never share a
  file, so their tickets can be built in parallel.
- **Flaky tests**: the last seven days of `CI` runs' logs, the `check` job's Playwright `N flaky`
  summary (`failOnFlakyTests` turns a retry into a red run). One `bug` + `ready-for-agent` issue per
  test name, deduped on the title (`src/maintain/flaky.ts`; the fixture is a real-shape
  `gh run view --log` excerpt in `test/fixtures/playwright-flaky.txt`).
- **Handoff hygiene**: every backticked repo path in `docs/agents/handoff/ticket-*.md` that git's
  tree no longer holds, as one `ready-for-human` issue (`src/maintain/handoff.ts`; marker
  `<!-- factory:handoff-hygiene -->`, refreshed by a comment when it is already open). Relative names
  (`src/view.ts`), routes (`/rooms`), globs, placeholders and generated output are not scanned.

A dry run prints what each step would open and writes nothing:

```bash
gh workflow run factory-maintain.yml -f dry_run=true
DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/maintain/run-handoff-hygiene.ts
DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/maintain/run-flaky-tests.ts
```

The architecture step needs `CLAUDE_CODE_OAUTH_TOKEN`; it prints the proposals and the label it would
give each under `DRY_RUN=1`.

### Red main (`factory-main-watch.yml`)

When `CI` fails on a push to `main`, the watch opens one `bug` + `ready-for-agent` + `priority:top`
issue carrying the failed jobs' log tail (`src/maintain/red-main.ts`, reusing `src/fix/excerpt.ts`)
and starts `factory-dispatch.yml`: the dispatch the failing push started saw neither the issue nor its
label. While an issue carrying `<!-- factory:red-main -->` is open, a second red run comments on it
instead. `PRIORITY_LABELS` in `src/dispatch/frontier.ts` sorts `priority:top` above age, so the next
free slot starts with it.

```bash
gh workflow run factory-main-watch.yml -f run_id=<failed CI run> -f dry_run=true
```

### Pausing it

Every workflow is manually dispatchable with `dry_run`, so a week can be skipped without touching the
tick's schedule. Dependabot itself is paused from the repository's **Insights → Dependency graph →
Dependabot** page, not from a workflow.

## Secrets

Three repository secrets, all set by the wizard:

```bash
./scripts/factory-secrets.sh
```

| Secret                    | What it is                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_PAT`               | Fine-grained PAT, this repo only: Contents, Issues, Pull requests, Actions read/write; **no** Workflows. Pushes and labels |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` on the owner's Claude Pro account; the judgement jobs spend this subscription, not an API key         |
| `OPENCODE_API_KEY`        | The OpenCode Go key that pays for omp's model calls (`oc_sk_…`)                                                            |

The wizard keeps what it captures in `~/.local/state/universum-factory/secrets.env` (mode 0600, never
in the repo: `docker compose` reads the repo's `.env` into the game containers). Re-run it to rotate
the PAT or to change accounts; each stage keeps the earlier value when you press Enter.

omp is installed from npm as `@oh-my-pi/pi-coding-agent` and pinned; it needs **Bun >= 1.4.4**
(`oven-sh/setup-bun`). Its `-p --mode json` stream is pi's own JSONL, which is why
`packages/factory/src/shared/agents.ts` builds the provider from Sandcastle's `pi()` and swaps the
binary.
