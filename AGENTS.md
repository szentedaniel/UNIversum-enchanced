# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (szentedaniel/UNIversum-enchanced), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Software factory

Tickets are implemented on GitHub Actions: the dispatcher picks the `ready-for-agent` frontier, omp implements, Claude Code reviews, and a merge gate merges the `risk:low` pull requests that touch no protected path; a red CI or review hands the pull request back to omp twice. The nightly retro turns the factory's recurring mistakes into durable fixes and logs the day in `docs/agents/factory-log.md`. See `docs/agents/factory.md`.
