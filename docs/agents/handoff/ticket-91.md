# Ticket #91 (weekly maintenance): extension points and gotchas

Branch `ticket/91-maintenance`, the last ticket of spec #85's maintenance block. The factory now
keeps itself healthy: Dependabot bumps take the normal review → CI → merge path, a weekly pass
proposes refactors, hunts flaky tests and stale handoff notes, and a red `main` becomes the next
ticket. Nothing of the game changed.

## Where the code is

`packages/factory/src/maintain/` holds one pure module and one thin script per pass:

| pure module    | script                   | workflow                 |
| -------------- | ------------------------ | ------------------------ |
| `proposals.ts` | `run-architecture.ts`    | `factory-maintain.yml`   |
| `flaky.ts`     | `run-flaky-tests.ts`     | `factory-maintain.yml`   |
| `handoff.ts`   | `run-handoff-hygiene.ts` | `factory-maintain.yml`   |
| `red-main.ts`  | `run-red-main.ts`        | `factory-main-watch.yml` |

The pure modules own the formats (`flakyIssueTitle`, `proposalIssueBody`, `handoffIssueBody`,
`redMainBody`), the dedupe and the label rules; the scripts only read `gh`, call the agent and
write. `test/flaky.test.ts` reads `test/fixtures/playwright-flaky.txt`, a real-shape
`gh run view --log` excerpt: a job/step/timestamp prefix per line, ANSI colours, and the list
reporter's `N flaky` block padded with `─`.

## The architecture pass

- **"Claude decides, the script writes"** (`run-architecture.ts`): `sandcastle.run` with
  `maxIterations: 1` and `Output.object({ tag: "proposals", schema: proposalsSchema })`, as the
  review step does; the resolved prompt must contain the literal `<proposals>` tag. A bad tag or
  schema fails the step before any issue is opened.
- **The prompt (`src/maintain/prompt.md`) opens with "Call the Skill tool with `codebase-design`"**,
  not a slash command. The pinned plugin 1.3.1 _does_ ship `improve-codebase-architecture`, but it is
  `disable-model-invocation: true` and interactive (writes an HTML report, asks which candidate to
  grill), so invoking it headless would derail. The pass keeps `codebase-design`'s vocabulary
  (module, interface, depth, seam, adapter, leverage, locality) and owns its output contract.
- **The door decides the label** (`proposalLabel`): `ready-for-agent` only for `twoWayDoor: true`,
  else `ready-for-human`. Two-way is the review's definition — a clean revert, no state, migration,
  protocol, public interface or lost data.
- The workflow pins the plugin (`mattpocock-skills@claude-plugins-official` 1.3.1) and Claude Code
  (2.1.311) like `factory-review.yml`; change both pins together.

## The flaky-test parser

- `flakyTestsOf(log)` reads only the `N flaky` summary block: an entry is
  `[project] › file:line:col › title`. The line ends with a ` ────` separator, and the whole line is
  yellow when colours are on; the parser strips the GitHub log prefix and ANSI first.
- **The dedupe key is the name without line and column** (`testNameOf`): `[project] file › title
  path`. A moved test must not open a second issue, so the issue title carries no line number; the
  body does (a snapshot of where it was).
- `failOnFlakyTests` is why a flaky test reddens CI; a test that fails every retry is `failed`, not
  `flaky`, and this pass ignores it (that is the bug issue's business).
- The script fetches each run's whole log with a 128 MB buffer; the pass reads 100 runs and keeps the
  last 7 days. An expired log is skipped, not an error.

## The handoff scanner

- A backticked span is a candidate only when it has no whitespace, glob, brace, angle bracket, `?` or
  `:`, does not start with `/`, and **its first segment is in git's tree**. That last rule is what
  keeps package-relative names (`src/view.ts`) and the owner's sibling checkout (`v1/…`) out.
- `alive` is `git cat-file -e HEAD:<path>` (the merged tree, not the working copy). `ignored` is
  `git check-ignore -q` on the path **and on `<path>/x`**: a directory-only rule
  (`apps/server/data/`) or a nested `.gitignore` only matches a child. `--quiet` takes one pathname
  at a time.
- `apps/web/src/paraglide` is the one generated path with no root ignore rule, so `handoff.ts` names
  it in `GENERATED`. Add a path there when a future build output starts showing up as dead.
- One issue, deduped by the body marker: an already-open issue gets a comment with the current list.

## Red main and the dispatcher

- `priority:top` is now in `PRIORITY_LABELS` (`src/dispatch/frontier.ts`), so the frontier sorts it
  above age. The red-main issue is a ticket (no sub-issues) with `bug` + `ready-for-agent` +
  `priority:top`; the watch starts `factory-dispatch.yml` itself because the failing push's own
  dispatch ran before the issue existed.
- The dedupe marker `<!-- factory:red-main -->` lives in the **issue body**; the watch lists open
  issues and comments on the one that carries it. A second red run does not open a second issue.
- `run-red-main.ts` reads `gh run view --log-failed` (128 MB buffer) and trims with
  `excerptOf` from `src/fix/excerpt.ts`; the body fences the excerpt with **four** backticks so a log
  that prints a fence stays readable.

## Dependabot in the pipeline

- `isFactoryPull(headRefName, labels, author)` grew a third argument: a `dependabot/…` branch counts
  only when the author is `dependabot[bot]` (`isDependabotPull`). `factory-fix.yml`'s preflight asks
  the same question in jq, so **change both together** (the preflight runs before the checkout).
- `mergeSubjectOf` names a Dependabot pull request by its **pull request number** because it closes
  no issue; every other factory pull request still fails the gate without one.
- `.github/dependabot.yml` prefixes commits with `build(deps)`: `check:commits` runs on the bump and
  Dependabot's own subject has no type. A grouped PR keeps the prefix.
- `factory-dependabot.yml` runs on `pull_request_target: opened` for `dependabot[bot]`, and **never
  checks out**: that event holds the base repository's token. It labels with `AGENT_PAT`, whose
  label event is the owner's — a workflow whose _actor_ is `dependabot[bot]` gets no secrets, so a
  job-token label would queue a review that cannot reach Claude.
- CI on a Dependabot PR runs with no secrets and a read-only token: `ci.yml` must stay that way.
- A Dependabot PR's review/merge path is unchanged; a red CI goes to `factory-fix` (now allowed) and
  a fix pushed with `AGENT_PAT` re-runs CI on the `dependabot/…` branch.

## Dry runs

```bash
DRY_RUN=1 GH_REPO=<owner>/<repo> CI_RUN_ID=<failed run> node packages/factory/src/maintain/run-red-main.ts
DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/maintain/run-flaky-tests.ts
DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/maintain/run-handoff-hygiene.ts
```

Every script prints its plan and writes nothing (`gh issue list` reads only). The architecture script
still calls the model under `DRY_RUN=1`; it needs `CLAUDE_CODE_OAUTH_TOKEN`.
