import { describe, expect, it } from "vitest";
import { checkRoomName } from "#room/room-name.ts";

describe("checkRoomName", () => {
  it.each([
    ["a plain name", "Friday game", "Friday game"],
    ["Hungarian letters", "Árvíztűrő tükörfúrógép", "Árvíztűrő tükörfúrógép"],
    ["German letters", "Größe Ärger", "Größe Ärger"],
    ["digits", "Room 42", "Room 42"],
    ["every allowed punctuation mark", "a-b_c.d,e!f?g'h&i", "a-b_c.d,e!f?g'h&i"],
    ["exactly 3 graphemes", "abc", "abc"],
    ["exactly 24 graphemes", "x".repeat(24), "x".repeat(24)],
  ])("%s: %j → %j", (_, raw, expected) => {
    expect(checkRoomName(raw)).toEqual({ ok: true, name: expected });
  });

  it.each([
    ["trims", "  Friday  ", "Friday"],
    ["collapses inner whitespace", "Friday \t\n  game", "Friday game"],
    ["applies NFKC (full-width letters)", "Ｆｒｉｄａｙ", "Friday"],
    ["applies NFKC (a combining accent composes)", "Ka\u0301lma\u0301n", "Kálmán"],
    ["applies NFKC (no-break space)", "Friday\u00a0game", "Friday game"],
  ])("normalises: %s", (_, raw, expected) => {
    expect(checkRoomName(raw)).toEqual({ ok: true, name: expected });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["only whitespace of several kinds", " \t\n\u00a0 "],
  ])("an empty name (%s) falls back to a generated one", (_, raw) => {
    expect(checkRoomName(raw)).toEqual({ ok: true, name: null });
  });

  it.each([
    ["a zero-width space", "Fri\u200bday"],
    ["a zero-width joiner", "Fri\u200dday"],
    ["a soft hyphen", "Fri\u00adday"],
    ["a byte-order mark", "\ufeffFriday"],
    ["a word joiner", "Fri\u2060day"],
    ["a right-to-left override", "Fri\u202eday"],
    ["a left-to-right embedding", "Fri\u202aday"],
    ["a right-to-left isolate", "Fri\u2067day\u2069"],
    ["a right-to-left mark", "Friday\u200f"],
    ["Cyrillic lookalike letters", "Fr\u0456d\u0430y"],
    ["Greek letters", "Αθήνα"],
    ["a letter outside the allowlist", "Façade"],
    ["an accent outside the allowlist", "Crème"],
    ["an emoji", "Party 🎉"],
    ["a slash", "a/b"],
    ["angle brackets", "<b>hi</b>"],
    ["a colon", "Game: one"],
    ["a hash", "Game #2"],
    ["a dangling combining mark (Zalgo)", "Zalgo\u0300\u0301\u0302"],
    ["2 graphemes", "ab"],
    ["2 graphemes after trimming", "  ab  "],
    ["25 graphemes", "x".repeat(25)],
    ["a long run of combining marks (over 96 bytes)", `abc${"\u0301".repeat(60)}`],
  ])("refuses %s", (_, raw) => {
    expect(checkRoomName(raw)).toEqual({ ok: false });
  });
});
