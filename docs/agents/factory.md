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
failing pull request back to omp at most twice. The weekly `factory:report` issue is a later ticket in
the same spec.

## Intake

The owner files a one-line idea as an issue; intake turns it into work the factory can start.
`factory-intake.yml` runs every night at 01:15 UTC (02:15 CET / 03:15 CEST, inside the Budapest
window) and can be dispatched by hand at any time — outside the window too:

```bash
gh workflow run factory-intake.yml                                   # every waiting issue
gh workflow run factory-intake.yml -f issue=93                       # one issue, whatever its labels
gh workflow run factory-intake.yml -f dry_run=true                   # print the decisions and writes
```

A scheduled run that starts after 07:00 Budapest does nothing (the script re-checks the window), so a
delayed cron spends no daytime Pro usage. One run handles at most `FACTORY_INTAKE_MAX` issues per
step (repository variable; default 3), oldest first.

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
(GitHub's native dependencies), that are not a spec (sub-issues), and that no open pull request
already closes. Oldest first — there is no priority label yet (`PRIORITY_LABELS` in
`packages/factory/src/dispatch/frontier.ts` is the seam) — and at most `FACTORY_MAX_PARALLEL`
implementers (default 2) run at once. An issue whose run is already queued counts as running, even
before its `agent:in-progress` label lands.

It runs when an implementation run finishes (a slot frees), on every push to `main` (a merge unblocks
dependants) and every 6 hours as a backstop; `concurrency: factory-dispatch` makes two triggers take
turns. Each dispatch is `gh workflow run factory-implement.yml -f issue=<n>` with `AGENT_PAT`.

Minutes come from the jobs API: every job of every `factory-*.yml` run created this calendar month
(UTC), rounded up per job the way GitHub bills. `FACTORY_MONTHLY_MINUTES` (default 1400) caps them.
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
`GITHUB_TOKEN` triggers no workflow. It also has **no workflows permission**, so no agent can change
`.github/workflows/`: a factory change is proposed as a `ready-for-human` issue with the patch inline.

## Reviewing a pull request

`factory-review.yml` runs when a pull request gets `agent:review`, when the owner dispatches it by
hand (`gh workflow run factory-review.yml -f pr=95`), and every night at 01:30 UTC.

1. **Queues** instead of reviewing when the Budapest clock is outside 01:00–07:00 and
   `FACTORY_DAY_REVIEWS` (a repository variable, default 2) daytime reviews already ran today. The
   run exits 0 and leaves `agent:review` in place; the 01:30 UTC cron dispatches one review per pull
   request still carrying the label, so a queued review happens at night. The count comes from the
   summary comments themselves — they open with `<!-- factory-review -->` — per Budapest calendar
   day, and night reviews do not spend the daytime quota.
2. Checks out the pull request's branch, installs Claude Code 2.1.311 and the
   `mattpocock-skills@claude-plugins-official` plugin, and **fails the step unless the plugin is
   1.3.1**: that version is the pin for the `code-review` skill, so a renamed skill fails loudly
   instead of reviewing with nothing.
3. Runs `node packages/factory/src/review/review.ts`: one Claude Code session on `claude-sonnet-5-5`
   invokes `/mattpocock-skills:code-review` against `origin/main`, with the pull request's linked
   issue and its parent spec as the Spec axis. The skill reports the Standards and Spec axes side by
   side; the same session then commits the fixes it is sure of (conventional commits, fast checks
   green) and emits `<review>` structured output — `verdict`, the `findings` it did **not** fix, and
   `mergeDanger`.
4. Pushes the reviewer's commits with `AGENT_PAT` (a plain push, never forced), posts one summary
   comment, and swaps `agent:review` for `risk:low` (only a two-way door with a local blast radius)
   or `risk:high`. A `changes-requested` verdict dispatches the fix loop
   (`gh workflow run factory-fix.yml -f pr=<n> -f reason=review`); a pass leaves the merge gate to
   decide and clears a stale `ready-for-human`.
5. On failure, comments the reason on the pull request, removes `agent:review` and adds
   `ready-for-human`: the night cron must not retry a broken review forever.

Claude runs with `--permission-mode bypassPermissions` (`claudeAgent` in `src/shared/agents.ts`):
Sandcastle's `noSandbox()` provider reports no sandbox, so it passes no permission flag, and
`claude -p` would deny every edit and Bash call. The runner is an ephemeral VM.

## Merging and fixing

Two steps finish a pull request: `factory-merge.yml` merges what the gates allow, and
`factory-fix.yml` sends a failing one back to omp.

### The merge gate

`factory-merge.yml` runs when a pull request's CI finishes **successfully**, when a review finishes
(whichever is last decides), and by hand. A failed CI run is the fix loop's. The gate code runs from a
**checkout of `main`**, never the pull request's copy: a PR that edits `packages/factory/` must not
decide its own merge.

It merges with a merge commit only when every gate holds ([spec #85, Decision
5](https://github.com/szentedaniel/UNIversum-enchanced/issues/85)):

1. The `CI` workflow concluded `success` on the pull request's head sha (a re-run that passed counts).
2. The newest `<!-- factory-review -->` comment says pass and was posted **after** the head commit;
   a push after the review queues `agent:review` again, so a fix commit is reviewed before merging.
3. The pull request carries `risk:low` — a two-way door with a local blast radius.
4. It touches no protected path: `.github/`, `packages/factory/`, `CODING_STANDARDS.md`, `AGENTS.md`,
   `CLAUDE.md`, `docs/agents/`, `docs/adr/`, `packages/rules/src/migrate.ts` and
   `packages/rules/test/fixtures/`. `docs/agents/handoff/` is the one exception: every implementer
   writes a handoff note and its `INDEX` line, so blocking those would block every ticket.
5. No `package.json` moves a dependency to another major (the first non-zero number for `0.x`).

The merge is `gh pr merge --merge --subject "chore(merge): #<issue> <title>"`. The issue gets a
comment naming the merge commit and is closed (`Closes #…` in the body already closed it). The push
to `main` starts `factory-dispatch.yml` by itself, so the next ticket is dispatched without a chain.

Green but gated → `ready-for-human` on the pull request and one comment listing every reason
("touches .github/", "one-way door: …", "dependency major: …"). A branch **behind main** goes to the
fix loop first (`main-moved`); when main's new commits change `.github/workflows/`, the PAT cannot
push them, so that too is `ready-for-human`. A pull request that is only _waiting_ — CI still
running, the review not posted yet, `agent:review` queued — exits quietly: the next trigger decides.

A dry run prints the decision and writes nothing:

```bash
gh workflow run factory-merge.yml -f pr=95 -f dry_run=true
DRY_RUN=1 GH_REPO=<owner>/<repo> PR_NUMBER=95 node packages/factory/src/merge/merge.ts
```

### The fix loop

`factory-fix.yml` runs when a pull request's CI concludes `failure`, when the review asks for
changes, and when the merge gate finds the branch behind main. omp gets one prompt
(`src/fix/prompt.md`) with the failure: the failed jobs' log tail (`gh run view --log-failed`,
trimmed to the prompt's budget), the review's findings, or the conflict it must resolve. It commits
on the branch and the workflow pushes with `AGENT_PAT`; CI runs again and the merge gate decides.

- The rounds are counted from hidden comments on the pull request,
  `<!-- factory-fix:round N -->`, so the CI and review triggers share one budget: **two** rounds
  (`MAX_FIX_ROUNDS` in `src/fix/rounds.ts`). A spent budget posts one escalation comment
  (`<!-- factory-fix:escalated -->`), adds `agent:blocked` + `ready-for-human` and runs no agent.
- Merging main in is housekeeping, not a round: a conflict-free merge is git's own merge commit, and
  only a conflict reaches the agent.
- A failed run (no commit, a dirty tree, `STATUS: BLOCKED`) comments the reason and adds the same
  two labels. Re-dispatch by hand to retry; the dispatch clears both labels first.

```bash
gh workflow run factory-fix.yml -f pr=95 -f reason=review      # ci | review | main-moved
```

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
