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

| Label                   | Means                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `ready-for-agent`       | Specified enough for an AFK agent; the dispatcher's frontier is these  |
| `ready-for-human`       | The owner implements it; protected paths and risky work land here      |
| `agent:in-progress`     | A run holds this issue; removed on every exit path                     |
| `agent:review`          | On a pull request: the review step may look at it                      |
| `agent:blocked`         | The last run failed or asked a question; the issue waits for a human   |
| `risk:low`, `risk:high` | The reviewer's merge-danger verdict (two-way door, local blast radius) |
| `spec:proposed`         | A spec draft waits for the owner's `spec:approved`                     |
| `spec:approved`         | The owner approved the spec; the next step splits it into tickets      |
| `factory`               | An issue about the factory itself; only the owner merges these         |
| `factory:report`        | The weekly health issue                                                |

The path a ticket takes:

```text
ready-for-agent ──dispatch──▸ agent:in-progress ──PR opened──▸ agent:review (on the PR)
                                        │
                                        └──any failure──▸ agent:blocked (on the issue)
agent:blocked ──re-dispatch──▸ agent:in-progress
```

`agent:review` is set by the implement run once its pull request exists; the review step (#86) takes
it from there, the merge gate and fix loop (#87) follow it. The `risk:*` verdict and the weekly
`factory:report` issue are later tickets in the same spec.

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
