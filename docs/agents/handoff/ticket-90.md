# Ticket #90 (the nightly retro): extension points and gotchas

Branch `ticket/90-retro`, the learning loop of spec #85. One Claude session reads the last day of the
factory's own trail, finds the recurring problems, and the script turns each into a durable fix — a
ticket, a standards pull request, a workflow issue — and appends the day to the factory log.

## Where the code is (`packages/factory/src/retro/`)

- **`collect.ts`** — mostly pure. `factsOf(raw, window)` shapes the raw `gh` output the fixture
  (`test/fixtures/retro-day.json`) also has; `hasActivity` is the workflow's skip decision. The
  `gh` reads are at the bottom (`fetchFacts`); the CLI entry is guarded by `import.meta.main`, so the
  test imports the module. It writes `OUTPUT_DIR/facts.json` and prints `true`/`false`; `DRY_RUN=1`
  also prints the facts to stderr.
- **`schema.ts`** — the `<retro>` answer: `findings` (each with `problem`, non-empty `evidence`,
  `severity`, and a `fix` discriminated on `kind`) and `logEntry` (defaults to `[]`, so a model that
  forgets the key does not lose the night's writes). `retro.ts` runs with `maxIterations: 1` and
  `Output.object({ tag: "retro", schema, maxRetries: 1 })`: one resumed retry for a malformed tag or
  schema, as the review step's structured output allows.
- **`plan.ts`** — the pure write decision: dedupe against open issue/PR titles, the write cap, patch
  path validation, body composition, branch/slug/commit-subject helpers, the log section. Tested in
  `test/retro-plan.test.ts`.
- **`retro.ts`** — the run and every write. Env: `GH_REPO`, `CLAUDE_CODE_OAUTH_TOKEN`, `OUTPUT_DIR`,
  `FACTORY_RETRO_MAX` (`positiveInt`, default 3), `DRY_RUN`.
- **`prompt.md`** — the contracts above, in prose.

## The facts (what a later ticket may extend)

- `pulls` are the factory pull requests (`agent/` branch or `factory` label) whose `updatedAt` is in
  the 24 h window: `state`, `labels`, `reviews` (verdict from `reviewVerdictOf`), `fixRounds`
  (`fixRoundOf`), `escalations`, `mergeEscalations`, `reviewerCommits`, `mergedAt`.
- `ciFailures` are `CI` runs concluded `failure` in the window, with the failed job names from the
  jobs API.
- `ownerComments` are comments on a factory issue/pull request by the repo owner (the PAT's account)
  whose body carries no factory sign. `isFactoryComment` lists the signs: every `<!-- factory-`
  marker, plus the prose the failure/merge/blocked paths write without one (`The factory could not`,
  `The fix loop could not`, `Factory fix:`, `Merged in`, `STATUS:`). A new factory comment without a
  marker must be added there or the retro reads it as the owner speaking.
- **Reviewer commits are inferred, not attributed.** The review, implement and fix workflows all
  commit as `universum-factory[bot]`, so the identity alone cannot tell the reviewer from omp. The
  rule: a factory commit in the interval after the pull request opened (or after the last marker
  comment before a review summary) and no later than that summary. The implementer's first push
  precedes the PR's creation; a fix round's commits precede its round marker. Merge commits and
  `chore(merge):` subjects are skipped. If a workflow changes the marker order, this rule is what
  breaks; `retro-collect.test.ts` pins it.

## The writes (and why each is a different kind)

- `issue` → `gh issue create --label ready-for-agent`; the body gets the protocol's
  `## Implementation context (for implementer agents)` section with the evidence.
- `standards-pr` → `git apply --check` on main, then branch `retro/<date>-<slug>`, one
  `docs(factory): …` commit (subject capped at 100, no trailing period), push with the PAT, and a
  `ready-for-human` pull request. The paths are limited to `CODING_STANDARDS.md`, `AGENTS.md`,
  `CLAUDE.md`, `GLOSSARY.md`, `docs/agents/` (not the log, not the handoff notes), `docs/adr/`, and
  `packages/factory/src/*/prompt.md`.
- `workflow-issue` → `gh issue create --label ready-for-human` with the patch in a fenced `diff`;
  the paths must be under `.github/workflows/` (the PAT cannot push workflows).
- Dedupe: the prompt gets the open issues (with body excerpts) and pull requests, and the script also
  compares normalised titles; a duplicate or a path violation is logged as `Skipped: …`, not written.
  `FACTORY_RETRO_MAX` caps what is written, not what is considered.
- **The log** (`docs/agents/factory-log.md`): the script fetches and fast-forwards `origin/main`,
  appends `## YYYY-MM-DD` (UTC) with Claude's bullets, the opened items and the skips, commits
  `docs(factory): retro log YYYY-MM-DD` with `[skip ci]` as the body, and pushes to `main`. A day
  with `logEntry: []`, no writes and no skips writes a single `- Nothing new.`. A day with no
  factory activity never reaches the step: the workflow sees `activity=false` and stops.

## The workflow (`.github/workflows/factory-retro.yml`)

Cron `30 3 * * *` UTC (after the review cron) plus `workflow_dispatch` (`dry_run`). The order
matters: checkout `main` with the PAT, `setup-node`, **collect** (no install), and only when the day
is active `pnpm install`, Claude Code `2.1.311`, the pinned `mattpocock-skills@claude-plugins-official`
1.3.1 check (copied from `factory-review.yml`: one Claude setup for the factory), git identity, and
`retro.ts`. The job token is read-only; every write is the PAT's, so the standards branch runs CI and
the log's push lands.

## Gotchas later tickets must know

- **The log is the health report's source (#92).** One `## <date>` section per run is the contract;
  keep the bullets plain (`- …`) and do not add markers the report would have to strip.
- **A quiet day leaves no entry** — the step is skipped before the model, by design. Do not "fix"
  that into a `Nothing new.` line; only an active day with no findings writes one.
- **UTC date:** the cron is 03:30 UTC, so the section date matches the Budapest day in both halves of
  the year. A hand-dispatched run after midnight UTC but before 01:00 Budapest still writes the UTC
  date.
- **The retro writes to `main` directly**, outside the merge gate. The log file is in `docs/agents/`
  (protected for pull requests) on purpose: the retro is the one writer that must not queue a
  protected PR for its own log. Do not route it through a PR.
- **`AGENT_PAT` has no Workflows permission.** Any `.github/workflows/` change must stay a
  `workflow-issue` with the patch inline; a `standards-pr` touching one is refused by
  `isStandardsPath`/`isWorkflowPath` in `plan.ts`.
- **Owner comments are a heuristic.** Anything the owner's account writes without one of the signs
  reads as the owner speaking. If #89's triage comments are written with the PAT (an Implementation
  context comment), add its opening to `FACTORY_COMMENT_SIGNS` or the retro will treat spec
  boilerplate as feedback.
- **The local dry run is two steps:** `DRY_RUN=1 OUTPUT_DIR=$(mktemp -d) node
  packages/factory/src/retro/collect.ts` (read-only, prints the facts to stderr and writes
  `facts.json`), then `DRY_RUN=1 … node packages/factory/src/retro/retro.ts` with
  `CLAUDE_CODE_OAUTH_TOKEN` from the wizard's secrets file. The agent's tree check compares `git
  status` before and after, so a dirty worktree does not fail a local run.
- The acceptance run (two pull requests with the same reviewer fix → one preventive issue/PR) is a
  real night's run after merge; the fixture pins the facts and `plan.test.ts` the write, not the
  model's judgement.
