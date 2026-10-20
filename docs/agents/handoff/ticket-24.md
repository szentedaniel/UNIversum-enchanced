# Ticket #24 (first playable slice) — extension points for #25–#46

Branch `ticket/24-first-slice` (on `v2-modernization`). Read the code next to each pointer; the comments there are the spec.

## Rules engine (`packages/rules/src`)

- **Shape:** `state.ts` (`GameState`, `PlayerState`, `FieldState`, `STATE_VERSION`), `intents.ts`, `events.ts`, `rejections.ts`, `handlers.ts`, `tx.ts`, `apply.ts`, `setup.ts`, `view.ts`, `rng.ts`, `rules/*.ts` (one module per rule area). Public API = `index.ts` only.
- **Phases / intents / events are open interface maps filled by declaration merging** in the area module — no shared union to edit. Pattern: `rules/turn.ts`:
  ```ts
  declare module "#state.ts" {
    interface PhaseMap {
      offer: { levels: number[] };
    }
  }
  declare module "#intents.ts" {
    interface PlayerIntentMap {
      BuyLevel: { level: number };
    }
  } // `turn` is added automatically
  declare module "#intents.ts" {
    interface SystemIntentMap {
      TurnTimedOut: {};
    }
  } // server-only, actor SYSTEM (= null)
  declare module "#events.ts" {
    interface EventMap {
      RentPaid: { player: PlayerId; amount: number };
    }
  }
  ```
  `Phase`/`Intent`/`GameEvent` are derived; `PhaseOf<K>`, `IntentOf<K>`, `EventOf<K>` narrow.
- **Intent handler:** export `const xxxIntents = { BuyLevel: { actor: "player", phases: ["offer"], run(tx, intent) {…} } } satisfies Partial<IntentHandlers>` and spread it into `HANDLERS` in `apply.ts` (one import + one spread line). `apply` already rejects wrong `turn` (`STALE_TURN`), wrong actor (`NOT_YOUR_TURN`), wrong phase (`NOT_OFFERED`), deep-copies state, bumps `version`. `run` mutates `tx.state`; return a `Rejection` to refuse (state then untouched).
- **Helpers (`tx.ts`):** `emit(tx, event)`, `setPhase(tx, phase)` (every phase change goes here → #25 adds `turnDeadline` in this one place), `decide(tx, phase)` (stop at a Player decision; otherwise the caller passes the Turn), `playerById`. `rng.ts`: `randomInt(tx, from, to)` (dice, Chance draws).
- **Turn flow:** `rules/turn.ts` `Roll` → `moveForward` (`rules/movement.ts`, pays Round bonus; reuse for Quarantine 12-roll #30 and Erasmus #31) → `landOn` (`rules/landing.ts`: `LANDINGS` record by FieldKind, all no-ops now — replace your kind's entry) → `if (!tx.decided) passTurn(tx)`. `passTurn` skips Bankrupt; #32 puts the game-end check at its top.
- **Rejection codes:** add to `RULES_REJECTION_CODES` (rules) AND `REJECTION_CODES` (protocol `messages.ts`, compile-time checked) AND a message in `apps/web/src/text.ts` `REJECTIONS` + `messages/{en,hu,de}.json`.
- **publicView** (`view.ts`) lists fields explicitly: a new `GameState` field fails to compile there until you decide whether clients see it; add derived numbers there.
- `Ctx = { actor: PlayerId | SYSTEM(null), now }`. State is plain JSON (apply copies with JSON round trip).
- **Board data** (`board.ts`, the only runtime import the web may use): `FIELDS` (id, key, kind, group; Quarantine group null = F1), `FIELD_COUNT`, `START_FIELD`. #26 adds Level prices here.
- **Tests:** `packages/rules/test/*.test.ts`, named by R-id. `test/helpers.ts`: `newGame({players, settings, seed, now})`, `accept/reject(state, intent, actor)`, `roll(state)`, `withPlayer(state, id, patch)`, `player(state, id)`, `diceOf(applied)`, `T0`, `SEED`. Tests import `#index.ts` only. Fixed seed → fixed dice; to land on a Field, roll once to read the dice, then place the Player `n − sum` before it (see R73 test).

## Protocol (`packages/protocol/src`)

- `messages.ts` (Zod-free, web may import): `GAME_ROOM`, `MESSAGE` names (`intent` c→s; `welcome`, `lobby`, `game` {view, events}, `rejected` {code} s→c), payload types, `RoomIntent` (`Start`), `ClientIntent`, `RoomSettings`/`CreateOptions`/`JoinOptions`, `PLAYER_COUNTS`, `MINUTE_LIMITS`, `DEFAULT_SETTINGS`, `REJECTION_CODES`, `Assert<>`, Player-name word lists (`player-names.ts`).
- `schemas.ts`: add each new Player intent schema to `PLAYER_INTENT_SCHEMAS` (strictObject, `turn`) — `PlayerIntentsMatchRules` won't compile until schema and rules agree. Room intents: `ROOM_INTENT_SCHEMAS` + `RoomIntent` type. Join options (#35 guest token, #36 password): `joinOptionsSchema` + `JoinOptions`.

## Room server (`apps/server/src`)

- `server.ts` `createGameServer({ gracefullyShutdown })` defines Room types; `main.ts` listens.
- `room/game-room.ts` `GameRoom` (no Schema state): `onCreate` (parse create options, `reserveRoomCode`, handlers incl. `"*"` → MALFORMED), `onJoin` (Seat: `newPlayerId`, `newPlayerName`), `onLeave` (Lobby frees Seat; game keeps it → #35 Seat hold), `onDispose` (`releaseRoomCode`), `onIntent` (safeParse → `ROOM_INTENTS` registry or `play` → `apply`; engine throw → INTERNAL), **`commit(state, events)`** = the one place that accepts a state: #34 writes the store here before the broadcast, #25 schedules the deadline here. `now()` method = clock seam. `startGame()` = Start (R5).
- `room/room-code.ts` `reserveRoomCode(isTaken)` (process-local set; #34 passes "still stored"). `room/ids.ts` (`newPlayerId`, `newSeed` from `node:crypto`). `room/player-names.ts`.
- **Tests:** `apps/server/test/helpers.ts` `startTestServer()` → `{ sdk, create(options), join(code), stop() }` (in-process, port 0, one per file via beforeAll). `TestClient`: `next(type)`, `until(type, predicate)`, `pending(type)`, `send(anything)`, `leave()`, `code`. To prove "sender only", trigger a later broadcast and check `pending("rejected")` is empty (see R5 test).

## Web (`apps/web/src`)

- Routes `App.tsx`: `/`, `/room/:code`, `/game/:code` (#36 adds `/rooms`, `/create`). Home reads `/?players=2&minutes=15` for create settings until the `/create` form exists (used by e2e).
- `connection.ts` = only writer of `roomStore`: `createRoom`, `joinRoom`, `ensureJoined`, `sendIntent`, `leaveRoom`, `JoinError(code)`; handlers registered synchronously after join (SDK drops early messages otherwise). #35 adds reconnection here.
- `stores/room-store.ts` (`status`, `code`, `me`, `lobby`, `push {view, events, seq}`, `rejection {code, seq}`), `stores/ui-store.ts` (`selectedField`; add camera/panels).
- `board/board.ts` `createBoard(host, {fieldLabel, onFieldTap})` → `{ update(view, events), destroy, fieldCenter, view }`; redraw on demand; **add an animation per event type as a `case` in `animationFor`**; newer push → `skipToEnd`. `board/layout.ts` (fieldToCell/cellToPoint, 2:1), `board/colors.ts`, `board/Board.tsx` (only React bridge; subscribes outside React).
- Test hooks `test-hooks.ts`: `window.universumTest = { fieldCenter, view, room }`, behind build constant `TEST_HOOKS_ENABLED` (dev: on; prod build: off unless `TEST_HOOKS=1`, which CI's build step sets for Playwright).
- **Text:** `messages/{en,hu,de}.json` (inlang message format) + typed maps in `text.ts` (`fieldName`, `playerName`, `rejectionText`, `formatMoney`). Paraglide output `src/paraglide/` is gitignored, generated by `postinstall` (`pnpm run paraglide` in apps/web) and by the Vite plugin; plugin is loaded locally (`node_modules/@inlang/plugin-message-format`, no CDN).
- Game screen: event toast `describe()` switch in `screens/Game.tsx` — add a case + message per new event.

## E2E (`apps/e2e`)

- Projects: `desktop-chromium`, `iphone-webkit` (each runs single-browser specs), `mixed-devices` (testMatch `two-guests.spec.ts`; the spec launches chromium + webkit itself). Add multi-Guest specs to the `MIXED` regex in `playwright.config.ts`.

## Repo / lint

- `pnpm run lint` = `oxlint --type-aware --type-check --disable-nested-config` (nested `.oxlintrc.json` in `.claude/worktrees/*` broke lint from the main checkout); CI uses it. Web lint override turns off `react-perf/jsx-no-new-function-as-prop`, `jsx-no-jsx-as-prop`, `unicorn/no-array-fill-with-reference-type` (Pixi `Graphics.fill`), allows CSS side-effect imports.
- New catalog deps: pure-rand 8.4.2, react-router 8.4.0, zustand 5.0.15, pixi.js 8.22.0, @inlang/paraglide-js 2.29.0, @inlang/plugin-message-format 4.5.4.
