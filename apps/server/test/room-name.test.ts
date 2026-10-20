import { describe, expect, it } from "vitest";
import { SEED } from "#room/blocked-words.ts";
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
    expect(checkRoomName(raw)).toEqual({ ok: false, code: "ROOM_NAME_INVALID" });
  });
});

describe("checkRoomName's word filter", () => {
  it.each([
    ["an English swear word", "fuck this"],
    ["an English word in capitals", "SHIT happens"],
    ["an English phrase", "Blow job party"],
    ["a word between punctuation", "game,fuck!"],
    ["an English stem", "Fuckers only"],
    ["a Hungarian word", "Kurva jó"],
    ["a Hungarian word without its accents", "Kurvak klubja"],
    ["a Hungarian word with its accents", "Kurvák klubja"],
    ["a Hungarian stem", "Faszkalap"],
    ["a hand-added Hungarian slur", "buzi"],
    ["a hand-added Hungarian slur with accents", "Köcsögök"],
    ["a hand-added Hungarian phrase", "baszd meg"],
    ["a German word", "Arschloch"],
    ["a German ß word folded", "Scheiße"],
    ["a hand-added German word", "Spast"],
    ["a hand-added German name", "Hitler fans"],
    ["a German stem", "Wichsers Runde"],
  ])("blocks %s: %j", (_, raw) => {
    expect(checkRoomName(raw)).toEqual({ ok: false, code: "ROOM_NAME_BLOCKED" });
  });

  it("blocks every seed entry that is a valid name on its own", () => {
    const checks = [...SEED.en, ...SEED.hu, ...SEED.de].map((entry) => ({
      entry,
      check: checkRoomName(entry),
    }));
    const valid = checks.filter(({ check }) => check.ok || check.code !== "ROOM_NAME_INVALID");

    expect(valid.length).toBeGreaterThan(400);
    expect(valid.filter(({ check }) => check.ok).map(({ entry }) => entry)).toEqual([]);
  });

  it.each([
    "Scunthorpe",
    "Cassandra",
    "Essex and Sussex",
    "Dickens fans",
    "Cocktail night",
    "Hancock",
    "grape juice",
    "therapist",
    "Penistone",
    "Assassins",
    "Kúra",
    "Kúria",
    "pelenka",
    "Búra",
    "fingerprint",
    "Barsch",
    "Mösenbach",
    "Faszination",
    "Faszén",
    "faszobor",
    "Baszk barátok",
    "Pina Colada",
    "Fickle friends",
    "Shitake",
    "Big black cat",
    "World domination",
    "Kur Urlaub",
    "Marha jó",
    "Szarvas",
  ])("lets an innocent name through (Scunthorpe whitelist): %j", (raw) => {
    expect(checkRoomName(raw)).toMatchObject({ ok: true });
  });
});
