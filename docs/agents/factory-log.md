# Factory log

The nightly retro's log, one dated entry per run: what the factory's day looked like, what recurring
problem the retro found, and which durable fix it opened for it. `packages/factory/src/retro/` writes
the entries; the weekly health report (`factory:report`, #92) reads them.

## 2026-11-09

- Handoff notes: the reviewer corrected stale or wrong handoff claims on five pull requests (#111, #137, #138, #152, #154), so a standards pull request makes the implementer verify them against the final diff before committing. The five red `main` CI runs on merge commits (#115, #119, #121, #123, #128) are the over-long merge subject already tracked in #141 and fixed by #142, which waits for the owner to merge; no new ticket.
- Opened pull request #161: Implementer: verify handoff note claims against the final diff before committing (retro/2026-11-09-implementer-verify-handoff-note-claims-against-the)
