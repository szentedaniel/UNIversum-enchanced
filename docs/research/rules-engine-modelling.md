# Research: rules engine modelling

Ticket: #4 (part of map #1). Feeds the decision ticket #10, "Choose the rules engine shape".
Researched 2026-10-18. Version numbers and repo activity below are as of that date.

## Question

How should a deterministic, testable, server-authoritative turn-based rules engine be modelled in TypeScript? Compare a pure reducer over intents, an event-sourced log, an XState statechart, and game frameworks such as boardgame.io. For each, cover deterministic randomness (dice, cards), turns and phases, timers, serialising state for storage and reconnect, and testing. Weigh each against the map's standing constraints: feature parity, about 1,000 concurrent Rooms at launch and 10x without a rewrite, a budget of about 50 USD/month on managed platforms, Guests who can reconnect, and Room state that survives deploys and restarts.

## What v1 looks like (for shape only; #5 catalogues the rules)

- All rules live in one Redux Toolkit slice on the client (`client/src/Store/slices/gameStateSlice.js`). Rules state (Players' money, Field ownership and level, quarantine counters) is mixed with UI flags (`showBuyPanel`, `showDoubler`, `selectErasmus`, ...).
- Most reducers are setters driven by components, not intents. Some reducers schedule `setTimeout` themselves (`minusTandij`, `buyMuseum`), which breaks reducer purity.
- Randomness is `Math.random()` in the browser (dice in `RollDice.jsx`).
- There are two clocks. One is the Room's game clock: `endDate` is set by the server to "now + N minutes" (`server/GameSystem/GameSystem.ts`). The other is a per-turn countdown that the active Player's client runs. That client emits a time-over and dispatches default actions such as auto-sell, pay tax and `nextPlayer` (`client/src/Components/GameComponents/PlayerInfo.jsx`).

The Redux style guide forbids exactly these patterns: reducers "must not execute any kind of asynchronous logic (AJAX calls, timeouts, promises), generate random values (`Date.now()`, `Math.random()`)", and actions should be treated "as 'describing events that occurred', rather than 'setters'" [R1]. So v2 has to restructure the rules as well as relocate them, as ADR-0001 already expects.

## Approaches compared

### A. Pure reducer over intents ("decide/apply")

**Shape.** One pure function, `apply(state, intent, ctx) -> { state, events } | Rejection`. Here `intent` is what a Player asked for (`RollDice`, `BuyField`, `SellFields`, `EndTurn`, ...) or a system intent (`TurnTimedOut`, `GameClockExpired`). `ctx` carries only the inputs that are not in state: the acting Player's id and the server's `now`. The host (the Room process) validates who is allowed to send what, calls `apply`, persists the result and broadcasts it. This is the Redux reducer contract [R1] with the client removed from the loop, as ADR-0001 requires.

- **Randomness.** Seed a PRNG once, when the Lobby becomes a game, from a CSPRNG: Node's `crypto.randomBytes` / `crypto.randomInt` are cryptographically secure, and `randomInt` avoids modulo bias [R2]. Keep the PRNG *state* inside the game state, so `apply` stays pure and a restart resumes the same sequence. `pure-rand` (v8.4.2) fits this well. It has a pure API that returns `[value, nextRng]`, unbiased `uniformInt` distributions, and the recommended `xoroshiro128plus` generator [R3]. Its generators expose `getState()`, and `xoroshiro128plusFromState(state)` rebuilds one, so the state round-trips through JSON [R4]. It is not a CSPRNG [R3]. That is acceptable here, because the seed and the PRNG state never leave the server (the same rule boardgame.io states [B1]). The deck order for cards is a seeded shuffle, stored as the remaining deck in state.
- **Turns and phases.** These are explicit in state as a discriminated union, for example `phase: { kind: 'awaitingRoll' } | { kind: 'deciding', options } | { kind: 'selectingFields', purpose } | { kind: 'gameOver', winner }`, plus `currentPlayer` and a turn counter. `apply` is a switch on `(phase.kind, intent.type)`, and any pair it does not handle is rejected. This is a hand-rolled flat state machine. It moves v1's UI flags (`showBuyPanel`, `selectDoubler`, ...) into one typed field, so the client renders from the phase instead of from a dozen booleans.
- **Timers.** Deadlines are *data*, not running timers. State holds absolute timestamps such as `turnDeadline` and `gameEndsAt`. The host schedules a wake-up for the earliest deadline. When it fires, the host feeds `TurnTimedOut { turn }` back through `apply`, which ignores the intent if the turn has already moved on. After a restart or deploy, the host reads the deadlines from the stored state and reschedules them. A deadline that passed during downtime fires at once. This is the server-side timeout that boardgame.io's maintainer favoured over client "pokes" [B6]. It also replaces v1's arrangement, where the active Player's client ran the per-turn countdown.
- **Serialisation.** State is plain JSON, including the PRNG state words, the deadlines and the phase. Storing it after every accepted intent, as `(roomId, version, state)`, is enough for restarts. A reconnecting Guest gets the current snapshot, or a per-Player view of it if any state is hidden.
- **Testing.** The cheapest of the four. Tests are table-driven: given state S and intent I, expect state S' or a rejection. A fixed seed gives fixed dice. Property tests can check invariants such as "money is conserved except for the bank", "no Field has two owners" and "bankrupt Players never become `currentPlayer` again". fast-check (v4.10.2) is built on pure-rand [R5], so one PRNG library would serve both the engine and its tests.
- **Costs.** You write the phase discipline and the timer host yourself, about a hundred lines of plumbing. Nothing draws the flow as a diagram for you.

### B. Event-sourced log

**Shape.** The stored source of truth is the append-only list of events, and state is a fold over them. Martin Fowler's definition: "all changes to application state are stored as a sequence of events", so state can be thrown away and rebuilt "by re-running the events from the event log on an empty application" [E1]. In practice this is approach A plus persisting the events that `apply` emits, with `evolve(state, event)` as the fold.

- **Randomness.** There are two options. (1) Store only the seed and the intents, and re-derive the dice on replay. This is fragile: any change to the order of PRNG draws in the code changes past games. (2) Store the *outcomes* in the events (`DiceRolled { values: [3, 5] }`, `CardDrawn { cardId }`). Fowler's guidance on external queries covers this: replay must reuse the value seen at the time, not recompute it [E1]. Option 2 is the robust one.
- **Turns, phases, timers.** The same as A. A timer expiry is just another recorded event (`TurnTimedOut`), and that gives an exact audit trail of why a turn ended.
- **Serialisation.** The log, plus periodic snapshots so reconnect and restart do not replay a whole game. Fowler describes snapshots as the standard optimisation [E1]. The cost is the versioning problem: when the rules change, old logs either replay under the old rules or need upcasting, and Fowler notes that fixing logic bugs means tracking "the difference between what happened with the bug, and what happens without it" [E1].
- **Testing.** Given past events, when this intent arrives, then expect these new events. Production logs become free regression fixtures and bug reproductions.
- **Fit.** A full event store as the *source of truth* is more than parity needs: no feature in scope reads history. Appending the events next to the snapshot is cheap, though, and pays off when debugging live disputes ("I rolled a 6, why did I land there?").

### C. XState v5 statechart

**Shape.** The turn and phase flow is modelled as a machine. Moves are events, rules are guards and `assign` actions over `context`, and each Room runs an actor. XState v5 is at 5.33.3 and actively developed (last push 2026-10-17) [X0].

- **Purity.** v5 has pure `transition(machine, snapshot, event)` and `initialTransition(machine)`, which return `[nextSnapshot, actions]` without starting an actor [X1]. So XState can also be used as a pure reducer.
- **Randomness.** XState has no RNG facility of its own. The PRNG state would live in `context` exactly as in A. A draw inside an `assign` has to thread the PRNG state through by hand to stay pure.
- **Turns and phases.** This is its strength. Hierarchical and parallel states, guards and the visual editor make the flow explicit and drawable. The flow in v1 is shallow, though: roll, move, resolve the Field, an optional decision or selection, end turn. Most of the rules are arithmetic over money and Fields, which would live in `assign` functions either way.
- **Timers.** Delayed transitions (`after`) are cancelled when their state is exited [X2], which matches a turn timeout well. They run on the actor's in-process clock, though. In the v5 source, the system records scheduled events with `startedAt: Date.now()`, but on `start()` it re-schedules each saved event with its full original `delay` [X3]. A restart therefore restarts the countdown instead of resuming it. The saved entries also hold `source` and `target` actor references [X3]. For a game that must survive deploys, you end up storing absolute deadlines in `context` and driving them from outside (as in A) anyway.
- **Serialisation.** `actor.getPersistedSnapshot()` and `createActor(machine, { snapshot })` restore deeply, including child actors. The state "must be JSON-serializable", and "actions from machine actors will not be re-executed" [X4]. The same page points to event sourcing for anyone who needs replay [X4].
- **Testing.** A `SimulatedClock` is exported for fake time [X5], and `xstate/graph` (shipped in the `xstate` package) exports `createTestModel` and path generators for model-based tests [X6]. That is good tooling, but the rule *values* (prices, tax, rent) still need ordinary example tests.
- **Costs.** It is another runtime and DSL to learn and keep. Rules end up split between machine config and `assign` and guard implementations. Its main gains, nested and parallel states and actors, address problems this game barely has.

### D. Game frameworks: boardgame.io (and neighbours)

**Shape.** You declare `setup`, `moves`, `turn` and `phases`. The framework owns the reducer (Redux 4 + Immer 9 internally), the multiplayer server (Koa 2 + socket.io 4), the lobby and storage [B0].

- **Status.** The last npm release is 0.50.2, from 2022-11-10. The repo still gets maintenance commits (dependency bumps and an ESLint migration in August 2026) but has shipped no release in almost four years [B0].
- **Randomness.** A built-in `random` API (`D6`, `Shuffle`, `Number`, ...) is passed to moves, and the PRNG state is persisted in `ctx` "so that moves can stay pure" [B2]. The PRNG is an inlined Alea from seedrandom [B2]. If no `seed` is set, it defaults to `Date.now().toString(36).slice(-10)` [B2][B3], so a CSPRNG seed would have to be passed in explicitly. The docs say "the RNG and its state must stay on the server" [B1].
- **Turns and phases.** It has first-class phases with `onBegin`/`onEnd`/`endIf`/`next`, turn order, and stages. `endIf` is checked game, then phase, then turn, after each step. `onBegin`/`onEnd` run only on the server [B4]. This is the most complete turn and phase vocabulary of the four and is worth borrowing, even if the library itself is not used.
- **Timers.** There are none. The "Timer" feature request (#92) has been open since 2018-01-26, and the maintainer concluded that server-side timeouts would be simpler than client-side ones [B6]. UNIversum's per-turn countdown and the Room's game clock would be bolted on outside the framework.
- **Serialisation.** The storage interface is async. It stores `state`, `initialState`, metadata and an appended `log`/`deltalog` [B5]. The built-in adapter is a flat file, and Postgres, Firebase and Azure adapters come from third parties [B7]. Pub/sub for multiple server instances is a small `GenericPubSub` interface with only an in-memory implementation in the repo [B8].
- **Testing.** Moves are plain functions. You can drive a headless client from a custom scenario, fix the `seed` or use `MockRandom`, and simulate several clients in local multiplayer mode [B9].
- **Fit.** The framework's main value is that it bundles a server, transport and storage. That pre-empts tickets #2, #3 and #9, which choose them against the budget and scale constraints, and ties the result to an unreleased dependency stack from 2022. Its client also runs moves optimistically and gets overridden by the master [B10]. Under ADR-0001 that matters little, but it is extra machinery.
- **Neighbours.** Colyseus (v0.18.9, active) is a *room server*, not a rules engine. It provides Rooms, message handlers, a room-scoped `clock` whose timers are cleaned up when the Room is disposed, schema state sync and `allowReconnection` [C1][C2]. It has no turn, phase or seeded-RNG abstraction, so it could *host* approach A or C. Which host to use belongs to #2, #3 and #9, not here.

## Comparison

| | A. Pure reducer | B. Event-sourced | C. XState v5 | D. boardgame.io |
|---|---|---|---|---|
| Determinism | By construction: PRNG state and `now` are inputs | Same as A; replay is safe only if outcomes are in the events | Possible via `transition()` [X1]; RNG is yours to thread | Built-in seeded RNG in `ctx` [B2] |
| Randomness | pure-rand, seed from `crypto` [R2][R3] | Store rolled values in the events [E1] | Same as A, in `context` | Alea; default seed comes from the clock [B2] |
| Turns and phases | Hand-rolled discriminated union | Same as A | Best-in-class hierarchy and guards | First-class phases, turns and stages [B4] |
| Timers that survive restarts | Absolute deadlines in state; the host reschedules | Same; expiries are logged | `after` restarts with the full delay after a restore [X3] | None (#92 open since 2018) [B6] |
| Storage and reconnect | One JSON snapshot per Room | Log plus snapshots; rules versioning burden | JSON persisted snapshot [X4] | Its own storage API and adapters [B5][B7] |
| Testing | Plain table and property tests, fast-check [R5] | Given/when/then on events | SimulatedClock, `createTestModel` [X5][X6] | Headless client, MockRandom [B9] |
| Dependency risk | Only pure-rand | None beyond A | One active, large library | No release since 2022-11 [B0] |
| Commits other tickets? | No | No (it is a storage shape) | No | Yes: server, transport, storage |
| Scale (10x) | State is tiny and CPU per intent is trivial; scaling is a hosting question | Same as A, plus log growth | Same as A | Bound to its Koa/socket.io server and pub/sub |

## Recommendation

Use **approach A, a pure reducer over intents**, and borrow two things from the others:

1. **From boardgame.io:** the *vocabulary*, meaning explicit phases with enter/exit hooks, an `endIf`-style check after each intent, and a server-only PRNG kept in state. Not the library itself.
2. **From event sourcing:** emit domain events from `apply`, and append them next to the snapshot, with random outcomes recorded in the events. The snapshot stays the source of truth for reconnect and restart. The log is for debugging, audit and replay fixtures. It can be dropped at no cost to the design if storage pushes back.

Concretely, the shape would be:

- **Engine package.** Pure TypeScript with no I/O, timers or `Math.random`/`Date.now`. It exports `createGame(config, seed, players, now)`, `apply(state, intent, ctx)` and `viewFor(state, playerId)`.
- **Randomness.** pure-rand `xoroshiro128plus`, seeded from `crypto.randomBytes` when the Lobby starts the game. Its `getState()` words are stored in the game state.
- **Timers.** Absolute `turnDeadline` and `gameEndsAt` live in state. The Room host keeps one wake-up per Room and turns it into a `TurnTimedOut` or `GameClockExpired` intent that carries the turn number, so a stale wake-up is ignored.
- **Persistence.** After each accepted intent the host writes `(roomId, version, state)`, with optimistic concurrency on `version`, then broadcasts. A reconnecting Guest gets `viewFor(state, guestPlayer)`.

**Trade-offs accepted:**
- You give up a drawable statechart and XState's tooling. The flow is shallow enough to read as a switch.
- You write the turn and phase plumbing and the timer host yourselves. boardgame.io would hand you the plumbing, but it has no timers and has been unreleased since 2022.
- The snapshot-first design gives up "rebuild from history" as the primary mechanism, in exchange for no rules-versioning burden on the hot path.
- Revisit XState if #5 finds deeply nested or concurrent sub-flows. Because the engine is a pure reducer, its `phase` handling could later move behind XState's `transition()` [X1] without changing the host contract.

## Open questions for #10 (grilling)

1. **Who keeps the clocks?** This is on the map's "Not yet specified" list. Do the per-turn countdown and the Room's game clock both become server deadlines in state? What happens to the active Player's turn when the clock runs out mid-decision (v1 auto-sells and pays tax on time-over)?
2. **Does the turn timer pause while a Player is disconnected,** or keep running so that the Room is not held hostage? This interacts with reconnect windows (#2, #9).
3. **Is there any hidden information** that needs a per-Player `viewFor`, such as the next card or other Players' pending selections, or is all state public?
4. **Snapshot-only, or snapshot plus event log?** Is the audit and replay value worth the storage writes at 1,000 Rooms, and what retention would apply?
5. **What counts as an intent versus a server-driven step?** Do automatic consequences (landing effects, round bonus, tax) chain inside one `apply` call, or as separate steps the client can animate? This shapes the event stream the UI animates from.
6. **Does #5's rules inventory show any concurrent or nested sub-flows** (quarantine rounds, doubler or Erasmus selection, forced selling) complex enough to justify XState over a flat phase union?
7. **Where does the engine package live** in the new repo layout (#12)? Is the client allowed to import it for local validation and UI hints (never authority)?
8. **What is the seed and RNG audit policy?** Should the seed be revealed after the game ends for dispute resolution, or never?

## Sources

- [R1] Redux Style Guide: reducers must not have side effects; avoid non-serializable values; model actions as events. https://redux.js.org/style-guide/
- [R2] Node.js docs, `crypto.randomBytes` / `crypto.randomInt`. https://nodejs.org/api/crypto.html
- [R3] pure-rand README (npm latest 8.4.2): pure usage, `uniformInt`, `xoroshiro128plus`, jump. https://github.com/dubzzz/pure-rand/blob/main/README.md
- [R4] pure-rand source: `RandomGenerator.getState()`, `xoroshiro128plusFromState`. https://github.com/dubzzz/pure-rand/blob/main/src/types/RandomGenerator.ts, https://github.com/dubzzz/pure-rand/blob/main/src/generator/xoroshiro128plus.ts
- [R5] fast-check 4.10.2 depends on `pure-rand ^8.0.0` (`npm view fast-check dependencies`). https://fast-check.dev/
- [E1] Martin Fowler, "Event Sourcing": definition, rebuild, snapshots, external queries, code changes. https://martinfowler.com/eaaDev/EventSourcing.html
- [X0] xstate on npm, 5.33.3; statelyai/xstate repo pushed 2026-10-17. https://github.com/statelyai/xstate
- [X1] Stately docs, Transitions: pure `transition()` / `initialTransition()`. https://stately.ai/docs/transitions
- [X2] Stately docs, Delayed transitions. https://stately.ai/docs/delayed-transitions
- [X3] XState source, scheduler and restore (`startedAt`, `start()` re-schedules with `delay`). https://github.com/statelyai/xstate/blob/6a85c4057dc7c0906381664249e0b1bac300cd92/packages/core/src/system.ts#L106-L130 and #L170-L174, #L233-L241
- [X4] Stately docs, Persistence. https://stately.ai/docs/persistence
- [X5] XState source, `SimulatedClock` export. https://github.com/statelyai/xstate/blob/6a85c4057dc7c0906381664249e0b1bac300cd92/packages/core/src/index.ts
- [X6] XState source, `xstate/graph` (`createTestModel`, path generators); the `./graph` export is in xstate@5.33.3's package exports. https://github.com/statelyai/xstate/blob/6a85c4057dc7c0906381664249e0b1bac300cd92/packages/core/src/graph/index.ts
- [B0] boardgame.io on npm: 0.50.2 published 2022-11-10; dependencies include koa ^2, socket.io ^4, redux ^4, immer ^9 (`npm view boardgame.io`). Repo commits through 2026-08. https://github.com/boardgameio/boardgame.io
- [B1] boardgame.io docs, Randomness ("The RNG and its state must stay on the server"; `seed`). https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/docs/documentation/random.md
- [B2] boardgame.io source, `random.ts` (PRNG state persisted in ctx; `Random.seed()` uses `Date.now()`) and `random.alea.ts` (Alea from seedrandom). https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/src/plugins/random/random.ts#L42-L57
- [B3] boardgame.io source, `plugin-random.ts` (default seed if `game.seed` is undefined). https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/src/plugins/plugin-random.ts#L30-L34
- [B4] boardgame.io docs, Phases. https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/docs/documentation/phases.md
- [B5] boardgame.io source, storage base (`state`, `initialState`, `log`, `setState(..., deltalog)`). https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/src/server/db/base.ts
- [B6] boardgame.io issue #92, "Timer" (open since 2018-01-26). https://github.com/boardgameio/boardgame.io/issues/92
- [B7] boardgame.io docs, Storage. https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/docs/documentation/storage.md
- [B8] boardgame.io source, `GenericPubSub` and in-memory pub/sub. https://github.com/boardgameio/boardgame.io/tree/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/src/server/transport/pubsub
- [B9] boardgame.io docs, Testing. https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/docs/documentation/testing.md
- [B10] boardgame.io docs, Multiplayer (client predictions overridden by the master). https://github.com/boardgameio/boardgame.io/blob/5e9a2c94bde803fae8b081958c406c4d0a7be8ae/docs/documentation/multiplayer.md
- [C1] Colyseus docs, Rooms (`clock`, state sync). https://docs.colyseus.io/room
- [C2] Colyseus docs, Reconnection (`allowReconnection`). https://docs.colyseus.io/room/reconnection
- v1 references: `client/src/Store/slices/gameStateSlice.js`, `client/src/Components/GameComponents/PlayerInfo.jsx`, `client/src/Components/GameComponents/RollDice.jsx`, `server/GameSystem/GameSystem.ts`.
