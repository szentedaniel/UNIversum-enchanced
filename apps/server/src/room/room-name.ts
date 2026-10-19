/**
 * The Room name check (spec: Abuse protection → Room name). The Room name is
 * the only text a Guest types that other Guests see, so it is normalised and
 * held to a small allowlist. The whole-word filter (`ROOM_NAME_BLOCKED`)
 * comes with the abuse-protection ticket (#37).
 */

export type RoomNameCheck =
  /** `name` is `null` when the creator left it empty: the client shows a generated one. */
  | { ok: true; name: string | null }
  /** `ROOM_NAME_INVALID`. */
  | { ok: false };

const MIN_GRAPHEMES = 3;
const MAX_GRAPHEMES = 24;
const MAX_BYTES = 96;

/** Invisible characters and the bidi controls (the "Trojan Source" class). */
const INVISIBLE_OR_BIDI = /[\p{Default_Ignorable_Code_Point}؜‎‏‪-‮⁦-⁩]/u;

/** Basic Latin letters, the Hungarian and German extras, digits, space and `- _ . , ! ? ' &`. */
const ALLOWED = /^[A-Za-z0-9áéíóöőúüűäßÁÉÍÓÖŐÚÜŰÄ \-_.,!?'&]*$/u;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const encoder = new TextEncoder();

export function checkRoomName(raw: string): RoomNameCheck {
  const normalised = raw.normalize("NFKC");
  if (INVISIBLE_OR_BIDI.test(normalised)) return { ok: false };
  const name = normalised.trim().replaceAll(/\s+/gu, " ");
  if (name === "") return { ok: true, name: null };
  if (encoder.encode(name).length > MAX_BYTES) return { ok: false };
  if (!ALLOWED.test(name)) return { ok: false };
  const length = [...graphemes.segment(name)].length;
  if (length < MIN_GRAPHEMES || length > MAX_GRAPHEMES) return { ok: false };
  return { ok: true, name };
}
