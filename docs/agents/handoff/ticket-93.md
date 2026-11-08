# Ticket #93 (factory tracer bullet): extension points and gotchas

Branch `ticket/93-factory-tracer-bullet`, the first ticket of spec #85 (the
software factory). One issue, dispatched by hand, implemented by omp on a
GitHub-hosted runner, opens a pull request. Nothing of the game changed.

## The package (`packages/factory`, `@universum/factory`)

- Modelled on `packages/repo-checks`: `"type": "module"`, `imports: {"#*":
  "./src/*"}`, `typecheck: tsc --noEmit`, its own `tsconfig.json`. Listed in the
  root `vitest.config.ts` `projects`, so `pnpm exec vitest run` covers it.
- One folder per step: `src/<step>/<step>.ts` + the `prompt.md` it hands the
  agent, and shared code in `src/shared/`. Scripts run with plain
  `node packages/factory/src/<step>/<step>.ts` (Node 26 strips types); there is
  no `tsx` and no build.
- Only dependency: `@ai-hero/sandcastle` pinned to `0.14.0`. `pi`,
  `claudeCode`, `run`, `noSandbox` and the `AgentProvider` /
  `AgentCommandOptions` / `PrintCommand` types are all public exports of that
  version.
- `oxfmt` formats the markdown too, so a new `prompt.md` or doc goes through
  `pnpm exec oxfmt` before the check can pass.

## The omp provider (`src/shared/agents.ts`)

- **`ompAgent()`** builds Sandcastle's `pi("opencode-go/deepseek-v4.1-flash:max",
  { captureSessions: false, env: { OPENCODE_API_KEY: required(...) } })`, spreads
  it, renames it `omp` and wraps `buildPrintCommand` / `buildInteractiveArgs` so
  the leading `pi` becomes `omp`. omp is a pi fork: only the binary differs, so
  every flag (`-p --mode json --model`, `--session <id>`) is pi's, and so is the
  JSONL stream pi's parser reads (`session`, `message_update`/`text_delta`,
  `turn_end`, `agent_end`).
- The `:max` suffix is the effort level, so **do not pass `thinking`** — the
  provider would add `--thinking` and override it.
- `test/agents.test.ts` pins the swapped command (starts `omp -p --mode json
  --model 'opencode-go/…:max'`), the prompt on stdin, `--session 'id'` on a
  resume, the provider's name/env and the interactive args. A model or binary
  change belongs there first.
- **`claudeAgent(model)`** is `claudeCode(model)` with
  `CLAUDE_CODE_OAUTH_TOKEN` from the env: the judgement jobs (#86, #89, #90)
  spend the owner's Pro subscription.

## The step (`src/implement/implement.ts` + `prompt.md`)

- Env contract: `ISSUE_NUMBER`, `ISSUE_TITLE`, `BRANCH`, `OPENCODE_API_KEY`,
  `OUTPUT_DIR`. `required()` prints `Missing required env var: <NAME>` and exits
  1, so a dry run without the key is the local smoke test.
- `sandcastle.run({ agent: ompAgent(), sandbox: noSandbox(), logging: { type:
  "stdout" }, promptFile: join(import.meta.dirname, "prompt.md"), promptArgs,
  maxIterations: 5 })`. `noSandbox()` defaults to the `head` branch strategy:
  the agent commits straight onto the branch the workflow checked out — no
  worktree, no merge step.
- `promptArgs` are `ISSUE_NUMBER`, `ISSUE_TITLE`, `BRANCH` and `ISSUE_CONTEXT`
  (the issue with its comments from `gh issue view --comments`).
- A run with **no commits** (`git rev-list --count origin/main..HEAD`) or **no
  report** fails: `fail()` writes `${OUTPUT_DIR}/failure_reason.txt`, which the
  workflow turns into the issue's failure comment.
- The report is `result.stdout` from its last line starting with `STATUS: `
  (`reportFrom` in `report.ts`), written to `${OUTPUT_DIR}/report.md` for the
  pull request's body. Narration before the report is dropped, so is a trailing
  `<promise>COMPLETE</promise>`, which is why the prompt tells the agent to end
  with the report as plain text.

## The workflow (`.github/workflows/factory-implement.yml`)

- `workflow_dispatch` with one input, `issue`. `run-name` names the issue;
  `concurrency: factory-implement-<issue>` lets one run per issue and queues a
  second; `timeout-minutes: 45`.
- **Preflight** refuses (comment, no branch) an issue that has **sub-issues**
  (a spec, not a ticket) or an open PR whose body says `closes|fixes|resolves
  #<n>`. Being a _sub-issue_ of a spec is what every ticket looks like, so a
  parent never blocks a run. The closing-keyword test is a jq regex over the PR
  bodies: `gh pr list --search "closes #93"` matches fuzzily (`ticket-93.md`
  mentions it, an open PR mentioning `spec #93` would too).
- Then: `agent:in-progress`, branch `agent/issue-<n>-<slug>` (slug is the
  title's first 50 slug characters, trailing `-` trimmed), the `ci.yml` setup
  block (checkout `v7` with `fetch-depth: 0` and the PAT, `pnpm/action-setup@v6`,
  `setup-node@v7` on `.node-version`, `pnpm install --frozen-lockfile`,
  `paraglide`), then `oven-sh/setup-bun@v2` at **1.4.4** and `bun i -g
  @oh-my-pi/pi-coding-agent@18.18.1`.
- Git identity `universum-factory[bot]` + its noreply address. Push is
  `--force` (a retry restarts from `main`); the branch lives only if the run
  made it. The PR is not a draft: title `Implement #<n>: <title>`, body
  `Closes #<n>` + the report, label `agent:review`.
- **Every** `gh` write sets `GH_TOKEN: secrets.AGENT_PAT` (job env). The job's
  own token is `contents: read`. A push or label with the default
  `GITHUB_TOKEN` starts no workflow, so CI would never run on the PR. The PAT
  has no Workflows permission, so a workflow change cannot be pushed by an
  agent: it is a `ready-for-human` issue with the patch inline.
- Failure: `agent:blocked` on the issue + a comment with
  `failure_reason.txt` and the run's link. `agent:in-progress` is removed with
  `always()`, so every exit path is clean. Re-dispatch is the retry.
- The minutes budget, `DRY_RUN=1`, the frontier and the fix loop are **not**
  here: #88 (dispatcher), #87 (merge gate + fix loop).

## What #86/#87/#88 build on

- **#86 (review)** starts from the `agent:review` label on the PR; the report in
  the PR body's `## Checks` / `## Deviations` is where a run says what it could
  not do. Read `STATUS:` from the body only as a hint: the body starts with
  `Closes #<n>`.
- **#87 (merge gate, fix loop)** — `risk:*` is still unused; auto-merge must
  check the protected paths itself (branch protection is unavailable on the
  free plan), and `packages/factory/`, `.github/`, `docs/agents/` are on that
  list, so factory PRs stay the owner's.
- **#88 (dispatcher)** — dispatch is `gh workflow run factory-implement.yml -f
  issue=<n>`; the run comment/labels above are the only state it can read. Two
  implementers at once means two concurrent dispatches; nothing shares a branch.
- **A later step's workflow** copies the setup block above verbatim; keep it in
  one place if a third workflow appears.
- Secrets (`scripts/factory-secrets.sh`, `docs/agents/factory.md`):
  `AGENT_PAT`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENCODE_API_KEY`. The wizard keeps
  its captured values in `~/.local/state/universum-factory/secrets.env`, never
  the repo's `.env` (compose would hand it to the game containers).
