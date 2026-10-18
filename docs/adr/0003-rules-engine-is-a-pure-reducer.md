# The rules engine is a pure reducer over intents

The v2 rules are one pure function, `apply(state, intent, ctx) → { state, events } | Rejection`, in a package with no I/O, no timers and no `Math.random`/`Date.now`. Turn flow is a flat `phase` field, the seeded PRNG and the deadlines (Turn timer, Minute limit) are plain data in the state, and the server's `now` comes in through `ctx`. We chose this so a Room can be stored as one JSON snapshot after every intent and restored after a restart with its dice and clocks intact, and so every rule can be tested as a pure function. The snapshot, not the event log, is the source of truth; events are kept beside it only for debugging and replay fixtures.

## Considered Options

- **boardgame.io**: the closest fit on paper, but it has no timers and no release since 2022, and it brings its own server, transport and storage.
- **XState v5**: a restored `after` timer restarts with its full delay, and the turn flow is too shallow to need nested states.
- **Event sourcing as the source of truth**: every rules change would have to replay or upcast old logs, with nothing in scope that reads history.

## Consequences

- Steps that need a click but offer no choice in v1 (closing a Chance card, confirming tax, the quarantine notice) are not intents: the effect applies at once and the client shows it from the event.
- One intent resolves every automatic consequence up to the next Player decision, so the client animates an ordered event list instead of acknowledging each step.
- The state shape is versioned; a deploy that changes it ships a pure migration, so running games survive it.
