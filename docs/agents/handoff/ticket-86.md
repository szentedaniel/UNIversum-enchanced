# Ticket #86 (the Claude reviewer): extension points and gotchas

Branch `ticket/86-claude-reviewer`, the second ticket of spec #85 (the software factory). When a
pull request gets `agent:review`, Claude Code reviews it with Matt Pocock's real `code-review` skill,
commits the fixes it is sure of, rates the merge danger, and the workflow turns that into one comment
and a `risk:*` label.

## The step (`packages/factory/src/review/`)

- **`review.ts`** owns one run. Env: `PR_NUMBER` and `BRANCH` (required), `ISSUE_NUMBER` (the issue
  the pull request closes, optional), `GH_REPO`, `CLAUDE_CODE_OAUTH_TOKEN`, `OUTPUT_DIR`. It builds
  the prompt args from `gh` (the PR, the issue with its comments, and the issue's parent spec —
  `spec.ts` reads the `Parent: #<n>` line; every fetch is best-effort so a missing issue still
  reviews). It writes `OUTPUT_DIR/review.json`, `comment.md` and `risk-label.txt`.
- **`sandcastle.run` uses `maxIterations: 1` and `output: Output.object({ tag: "review", schema })`**
  (Sandcastle 0.14 allows structured output only at one iteration). The resolved prompt must contain
  the literal opening tag; the extractor takes the **last** `<review>` block in stdout, so the prompt
  example is harmless. A bad tag or schema throws `StructuredOutputError`, which `fail()` turns into
  `failure_reason.txt`.
- **The prompt opens with `/mattpocock-skills:code-review ...`**, real slash command first, so Claude
  Code expands the plugin skill in print mode; the rest of the file is passed as the skill's
  arguments (fixed point `origin/main`, the spec, then the factory's own rules for applying and
  committing fixes). The skill reports the two axes and does not commit; the extra instructions make
  the same session commit and emit the verdict. Verified locally in print mode (see below).
- **`claudeAgent` sets `permissionMode: "bypassPermissions"`.** Sandcastle passes
  `--dangerously-skip-permissions` only when the sandbox provider's tag is not `"none"`, and
  `noSandbox()` is `"none"`, so before #86 every `claude -p` factory run would have had every Edit
  and Bash call denied. All later judgement steps (#89 triage, #90 retro) inherit the fix; do not
  drop it without replacing it with `--allowedTools`.
- The reviewer must leave a clean tree; `review.ts` fails on `git status --porcelain` output after the
  run. The workflow, not the agent, pushes.

## The pure modules (all with vitest in `packages/factory/test/`)

- **`window.ts`**: `Europe/Budapest` via `Intl` (`formatToParts`, `h23`), so it is DST-safe; the night
  window is **[01:00, 07:00)**, and `reviewDecision` always allows a night run. `REVIEW_MARKER`
  (`<!-- factory-review -->`) is the quota's source of truth; `daytimeReviewsToday` counts only
  today's marker comments posted **outside** the night window, so night runs never spend the daytime
  slots. Default quota 2.
- **`gate.ts`**: the thin CLI the workflow calls before touching the branch. It fetches repo-wide
  issue comments (`gh api repos/$GH_REPO/issues/comments?since=… --paginate --jq …`), prints `true`
  or `false`, and **fails closed** (a `gh` failure exits 1 rather than reviewing without a quota
  check). `FACTORY_DAY_REVIEWS` is a repository variable; empty means 2.
- **`merge-danger.ts`**: `risk:low` only for `two-way` + `local`; everything else is `risk:high`.
  `risk:*` was unused before this ticket; the merge gate (#87) reads these labels.
- **`summary.ts`**: the one comment. Its first line is the hidden marker — changing that string breaks
  the quota silently, so a test pins it.

## The workflow (`.github/workflows/factory-review.yml`)

- Triggers: `pull_request: labeled` filtered in the job `if:` to `agent:review`;
  `workflow_dispatch` with `pr`; cron `30 1 * * *` UTC (02:30 CET / 03:30 CEST, inside the window).
  The cron job only dispatches `workflow_dispatch` runs, one per open PR still labelled `agent:review`
  (up to 100); the per-run gate still decides.
- **Two checkouts**: `main` first, so the gate runs the reviewed-workflow-free copy of
  `packages/factory`; then the pull request's head branch, with `fetch-depth: 0` for
  `git diff origin/main...HEAD`. Git identity is `universum-factory[bot]`. All writes use
  `AGENT_PAT` (`GH_TOKEN`); the job token is `contents: read`.
- After the run: push `HEAD:<branch>` (no force, only if the tip moved), post `comment.md`, remove
  `agent:review` and both `risk:*` labels, add the new `risk:*`; `changes-requested` also adds
  `ready-for-human`, and a later `pass` removes it. Until #87 exists there is no fix loop, so
  `ready-for-human` is the placeholder handoff.
- **Failure path** comments `failure_reason.txt` + the run link, removes `agent:review` and adds
  `ready-for-human`: if it stayed queued, the night cron would retry a broken review forever.
- A queued run (outside the window, quota spent) exits 0 **before** the second checkout and leaves
  everything alone.

## Local smoke of the real skill (2026-11-08)

One run against a throwaway branch cut from `main` (a tiny `greeting.ts` plus a fake `gh` that served
a matching spec; no issue or pull request was touched). The skill triggered in print mode: both
sub-agent reports came back (Standards and Spec, side by side), the session committed
`fix(factory): name the greeting helper greetingFor and pin it with a test`, ran the factory's vitest
(13 tests), and ended with a valid `<review>` block. `review.ts` wrote `verdict: pass`,
`findings: []`, `two-way`/`local`, `risk-label.txt` = `risk:low`. 47 s, 43k context. If the skill ever
stops expanding (a plugin rename, a Claude Code change), the first sign is a review with no
`<review>` tag or findings that ignore the repo's standards; check `claude plugin list --json` first.

## What #87/#88 build on

- **#87 (merge gate, fix loop)**: `risk:low` on a pull request means two-way + local, but the gate
  still checks protected paths itself (factory PRs always stay the owner's). Replace the
  `changes-requested -> ready-for-human` placeholder with the omp fix dispatch, and consume
  `review.json` if the fix loop needs the findings.
- **#88 (dispatcher)**: the cron's `gh workflow run factory-review.yml -f pr=<n>` pattern is the one
  to copy; the label remains the queue, so a dispatch never needs its own state.
- **Any new Claude judgement step**: copy the Claude Code install + `mattpocock-skills` pin check
  block, and use `claudeAgent(model)` (it already bypasses permissions on `noSandbox`).
