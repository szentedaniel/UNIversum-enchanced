/mattpocock-skills:code-review Review pull request #{{PR_NUMBER}} on branch `{{BRANCH}}` against `origin/main`.

This is the factory's review step. The owner's decision: run the real `mattpocock-skills:code-review` skill, not a re-written checklist. Follow the skill's process, including its parallel Standards and Spec sub-agents, and report the two axes side by side.

# THE PULL REQUEST

{{PR_CONTEXT}}

# THE SPEC

{{ISSUE_LINE}}

{{ISSUE_CONTEXT}}

# STANDARDS

The Standards axis reads this repository's own documentation:

- `CODING_STANDARDS.md`: the judgement calls a reviewer checks a diff against.
- `GLOSSARY.md`: the terms to use, and the _Avoid_ synonyms to reject.
- every `docs/adr/` record the diff touches.
- the skill's smell baseline, where the repo says nothing.

`oxfmt`, `oxlint`, `tsc`, `vitest` and the repo's fences already run in CI: do not re-report what tooling enforces.

# AFTER THE REVIEW

The skill reports; it does not commit. Apply every fix you are sure of, on this branch:

- Stay inside the pull request's diff. Do not add features, dependencies, abstractions or refactors the spec did not ask for, and do not reformat untouched code.
- Make the change the repository's code already implies: match the neighbouring code and the documented standards rather than introducing a second pattern.
- Run the fast checks after a change: `pnpm exec oxfmt`, `pnpm run lint`, `pnpm -r run typecheck`, `pnpm exec vitest run`. Never run Playwright or `docker compose build`: CI owns those.
- Commit with `type(scope): description`, a type from `packages/repo-checks/src/commits.ts`, and no AI attribution. One commit per green slice is fine.
- Leave the working tree clean: commit or revert everything before you finish. The workflow pushes your commits; you never push.

Never change `.github/workflows/`: the factory's token has no Workflows permission. If a finding needs one, leave it in `findings`.

Never comment on the pull request, label it, or open another one: the workflow posts the one summary comment.

# THE OUTPUT

End your final message with exactly one `<review>` block: valid JSON, no code fence, nothing after it.

<review>
{"verdict": "pass", "findings": ["..."], "mergeDanger": {"door": "two-way", "blastRadius": "local", "reason": "..."}}
</review>

- `verdict`: `pass` when nothing is left that a person must decide or that you could not fix; `changes-requested` otherwise.
- `findings`: only what you did not fix, or were not sure enough to fix. The fixes are the commits, not findings. `[]` when there are none.
- `mergeDanger.door`: `one-way` when undoing it is expensive — stored state or a migration, a protocol or wire change, a public interface, data loss; `two-way` when a revert is clean.
- `mergeDanger.blastRadius`: `local` when the diff stays in one package, app or factory step; `wide` when it spans packages, or changes shared behaviour or a contract.
- `mergeDanger.reason`: one sentence a person can check.
