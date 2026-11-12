# Ticket #224 (Podium rematch button and vote chips) — extension points and gotchas

Branch `agent/issue-224-web-podium-rematch-button-and-vote-chips`, from main at
`febfbc2`. The second slice of spec #175: a Player asks for a rematch on the
Podium, takes it back, and sees who has agreed. The Room stays ended; #225/#226
own the return to Lobby state.

## What landed

- **Store.** `Push.rematch?: readonly PlayerId[]`, and the same field on
  `ReceivedPush`; `receivePush` copies it into the push it stores
  (`apps/web/src/stores/room-store.ts`). A vote push carries no events and the
  same view `version`, and the guard drops only a strictly older version, so a
  vote replaces the shown list. A push without the key (a running game) stores
  `rematch: undefined`.
- **Vote view.** `apps/web/src/pick/podium.ts` gains
  `podiumRematch(players, me, agreed)` next to `podiumOrder`. It returns
  `{ votes, mine }`: `votes` is one `{ player, agreed }` per Guest in Seat order
  (Bots filtered out), `mine` is `{ agreed, intent }` — `Rematch` or
  `WithdrawRematch` — or `null` when `me` holds no Seat. It is pure and reads
  the list on every call, so nothing caches a vote.
- **Podium.** `Podium` takes `{ view, phase, rematch, me, busy }`; `Game.tsx`
  passes `push.rematch`, the store's `me` and `inFlightOf` in its `podium` slot.
  The button sends `sendIntent(mine.intent)` and is disabled while busy. Test
  ids: `rematch-button`, `rematch-chip` (with `data-player` and
  `data-agreed="true"` when agreed), `rematch-votes` on the list.
- **Messages.** `rematch_button`, `rematch_withdraw`, `rematch_agreed`,
  `rematch_waiting`, `rematch_votes` in hu/en/de.
- **Tests.** `apps/web/test/podium-rematch.test.ts` drives the store's public
  writes (`receivePush`, `markIntentSent`) and `podiumRematch`, then renders the
  Podium with React's server renderer (`renderToStaticMarkup` inside
  `StaticRouter`) from the store's latest push. `apps/web/tsconfig.node.json`
  gained `"jsx": "react-jsx"` for that render.

## Extension points and gotchas

- **#225/#226** switch the screen when the Room returns to Lobby state; the
  Podium's button and chips need no change. Remember that `roomStore.push` keeps
  the last game push until the next one arrives: removing the Podium is the
  screen switch's job (the `podium` slot exists only while the frame's phase is
  `gameOver`), not the votes' presence.
- **Do not move the votes into the Playback frame.** A vote push has no events,
  so its frame shows the same game; the list lives on the push (`push.rematch`)
  and is passed to the Podium as a prop.
- **`busy` is a prop, not a store read.** `Game.tsx` already reads `inFlightOf`
  for the Decision and passes it down. A zustand read inside the Podium would be
  invisible to React's server renderer (#125), which is how the test renders it.
- **No DOM test environment is installed.** The render test asserts markup
  strings and cannot press the button; the press is pinned by `podiumRematch`'s
  `intent` (the one value the `onClick` sends) and the label by the markup. A
  real click still needs the browser: the e2e suite.
- **Bots never get a chip and never vote**: `podiumRematch` filters
  `player.bot`, and the server refuses a Bot's vote with `NOT_OFFERED` (#223).
- **`showView` in `apps/web/src/test-hooks.ts` sends no `rematch`** — on
  purpose: the e2e podium spec's fake game-over push renders every chip as
  waiting, and no button (its made-up Player ids are not the client's `me`). Add
  an argument there only if a spec needs a vote.
