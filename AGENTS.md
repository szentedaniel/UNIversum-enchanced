# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (szentedaniel/UNIversum-enchanced), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Software factory

Tickets are implemented on GitHub Actions, dispatched by hand (`workflow_dispatch`) until the dispatcher (#88) lands; omp implements, Claude Code reviews. See `docs/agents/factory.md`.
