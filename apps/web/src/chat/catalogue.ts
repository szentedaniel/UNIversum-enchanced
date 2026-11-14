/**
 * What a quick-chat id shows by the sender's Player card (#176, #230): the line
 * in the viewer's language, or an emote's language-free glyph with its
 * accessible label. The table is keyed by every protocol `ChatId`, so an id
 * without a face fails to compile; each message key is named explicitly (never
 * built by string concatenation), so the messages stay typed and
 * tree-shakeable. Chat text is never user input: it comes from here only.
 */
import type { ChatId } from "@universum/protocol/messages";
import { m } from "#text.ts";

/** What one bubble shows: a line's text, or an emote's glyph and its accessible label. */
export type ChatFace =
  | { kind: "line"; text: string }
  | { kind: "emote"; glyph: string; label: string };

type ChatEntry =
  | { kind: "line"; text: () => string }
  | { kind: "emote"; glyph: string; label: () => string };

/** One entry per protocol id: the lines first, then the emotes, as `CHAT_IDS` lists them. */
const CHAT_CATALOGUE: Record<ChatId, ChatEntry> = {
  good_luck: { kind: "line", text: m.chat_line_good_luck },
  well_played: { kind: "line", text: m.chat_line_well_played },
  nice_move: { kind: "line", text: m.chat_line_nice_move },
  thanks: { kind: "line", text: m.chat_line_thanks },
  hurry_up: { kind: "line", text: m.chat_line_hurry_up },
  oops: { kind: "line", text: m.chat_line_oops },
  good_game: { kind: "line", text: m.chat_line_good_game },
  rematch: { kind: "line", text: m.chat_line_rematch },
  cheer: { kind: "emote", glyph: "🎉", label: m.chat_emote_cheer },
  groan: { kind: "emote", glyph: "😩", label: m.chat_emote_groan },
  thinking: { kind: "emote", glyph: "🤔", label: m.chat_emote_thinking },
  laugh: { kind: "emote", glyph: "😂", label: m.chat_emote_laugh },
  shock: { kind: "emote", glyph: "😮", label: m.chat_emote_shock },
  heart: { kind: "emote", glyph: "❤️", label: m.chat_emote_heart },
};

/** The face of `id`'s bubble, in the language active when the bubble appears. */
export function bubbleOf(id: ChatId): ChatFace {
  const entry = CHAT_CATALOGUE[id];
  return entry.kind === "line"
    ? { kind: "line", text: entry.text() }
    : { kind: "emote", glyph: entry.glyph, label: entry.label() };
}
