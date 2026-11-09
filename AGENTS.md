# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (szentedaniel/UNIversum-enchanced), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Software factory

Tickets are implemented on GitHub Actions: the dispatcher picks the `ready-for-agent` frontier and omp implements, Claude Code reviews. Intake turns a one-line issue into a ticket or a spec (the owner approves specs with `spec:approved`). See `docs/agents/factory.md`.
