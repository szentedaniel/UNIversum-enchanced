# Ticket 188 — the Lobby list marks non-default Room settings

- `LobbyListingMetadata` (`packages/protocol/src/messages.ts`) now carries
  `settings: RoomSettings` instead of the flat `maxPlayers` and `minuteLimit`:
  one entry for the whole `RoomSettings` record, so a later Room setting reaches
  the Lobby list without another protocol field. `LobbyListing` is still
  `LobbyListingMetadata & { code }`. The server fills it in `GameRoom.listing()`
  (`apps/server/src/room/game-room.ts`), which is both `this.metadata` in
  `onCreate` and the `setMetadata` call in `broadcastLobby()`; `TestLobbyList`
  (`apps/server/test/helpers.ts`) and the web's `watchLobbyList` cache spread the
  metadata unchanged, so nothing else changed shape.
- The mark is computed in the web, not the server: `customSettingsText(settings)`
  in `apps/web/src/text.ts` reads `CUSTOM_SETTING_LINES`, one line per
  `keyof RoomSettings`, and keeps the ones whose value differs from
  `DEFAULT_SETTINGS`. It is a `Record<keyof RoomSettings, …>`, so adding a Room
  setting to the protocol fails `tsc` here until it gets a line (and a message
  if the existing labels do not fit). The lines are `rooms_setting_players`
  (`{max} players`), `lobby_minute_limit` and `lobby_starting_cash`, and every
  Room setting counts: a 2-Seat or 15-minute Lobby is marked too, because
  `GLOSSARY.md` calls the Seat count and Minute limit Room settings.
- `LobbyList.tsx` renders the non-empty list under the Players/Minute line as
  `data-testid="custom-settings"`, prefixed by `rooms_custom_settings`
  ("Custom settings") and joined with " · ". A Lobby on `DEFAULT_SETTINGS`
  renders no mark.
- Tests: `apps/server/test/lobby-list.test.ts` pins the listing shape and that a
  custom setting reaches the entry ("carries every Room setting, so the list can
  mark the ones off the defaults"); `apps/web/test/custom-settings.test.ts`
  pins the mark's text in en/hu/de and that all settings are compared.
- Existing `apps/e2e/tests/lobby-list.spec.ts` creates a Lobby with
  `maxPlayers: 2, minuteLimit: 15`, so its tile now also shows the mark; the
  spec asserts only what it asserted before, and the mark has no e2e assertion
  of its own (#188's acceptance asks for the server test).
- The old flat listing fields are gone: any test or screen reading
  `lobby.maxPlayers`/`lobby.minuteLimit` must go through `lobby.settings`.
