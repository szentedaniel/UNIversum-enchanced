# Ticket #228 (quick-chat protocol) — catalogue, message and schema

Branch `agent/issue-228-protocol-quick-chat-catalogue-chat-message-and-sch`, from `main`. Spec #176.
The seam the server (#229) and web (#230–#233) chat tickets build on; nothing uses it yet.

## Catalogue (`packages/protocol/src/messages.ts`, Zod-free)

- `CHAT_LINES` = `good_luck`, `well_played`, `nice_move`, `thanks`, `hurry_up`, `oops`,
  `good_game`, `rematch` (8); `CHAT_EMOTES` = `cheer`, `groan`, `thinking`, `laugh`,
  `shock`, `heart` (6). All are `as const`.
- `ChatLineId` / `ChatEmoteId` derive from the two arrays; `ChatId = ChatLineId | ChatEmoteId`;
  `CHAT_IDS = [...CHAT_LINES, ...CHAT_EMOTES]` (lines first) is what the schema accepts.
- **Ids are stable forever.** The web derives its message keys from them (#230:
  `chat_line_<id>`, `chat_emote_<id>`), so never rename or reuse one; a removed line keeps
  its id reserved. A new line/emote is appended, gets hu/en/de messages, and updates the
  pinned catalogue test in `packages/protocol/test/chat.test.ts`.

## Wire shapes and schema

- `MESSAGE.chat` (`"chat"`) goes both ways: client → server `ClientChat = { id: ChatId }`
  (no sender: the Seat comes from the connection), server → every client
  `ChatEvent = { seat: number; id: ChatId }` (the sender's Seat). `seat` is the
  sender's Seat number, the index into the Room's Seats.
- `packages/protocol/src/schemas.ts` has `chatSchema = z.strictObject({ id: z.enum(CHAT_IDS) })`,
  exported from `@universum/protocol`; extra keys (a `seat`, a `text`), an unknown or
  non-string id and free text all fail. `ChatMatchesClient` fails to compile if the schema
  and `ClientChat` drift, including when `CHAT_IDS` misses an id.
- Chat is not a `PlayerIntent`: `PLAYER_INTENT_SCHEMAS`, `intentSchema`, the rules package
  and `GameState` were not touched.

## Tests

- `packages/protocol/test/chat.test.ts` pins the exact catalogue and `MESSAGE.chat`, checks
  the ids are unique and `CHAT_IDS` covers both arrays, accepts every id through
  `chatSchema`, and refuses unknown ids, extra fields and free text.

Read for: #229 (server broadcast), #230–#233 (catalogue, tray, bubble, e2e), any chat id or
wire-shape touch.
