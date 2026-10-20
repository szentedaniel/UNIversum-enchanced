/**
 * The Room name word filter (spec: Abuse protection → Room name). It matches
 * whole words and phrases, never substrings, on a diacritic-folded, lowercased
 * copy of the name, so "Scunthorpe", "Essex" or "grape" pass. Hungarian
 * inflects by suffixes, so a few roots are also matched as word prefixes
 * (`STEMS`); the whitelist (`ALLOWED`) rescues the innocent words they catch.
 * A match is refused (`ROOM_NAME_BLOCKED`), never masked.
 */
import { SEED } from "#room/blocked-words.ts";

/** Hand-added words and phrases LDNOOBW lacks: Hungarian and German slurs, Nazi references. */
const ADDED: readonly string[] = [
  // hu
  "buzi",
  "buzik",
  "köcsög",
  "bazdmeg",
  "baszdmeg",
  "bazd meg",
  "kurvaanyád",
  "anyád picsája",
  "ribanc",
  "ribancok",
  "nyomorék",
  "csicska",
  "náci",
  "nácik",
  "szopd le",
  "szopjál le",
  // de
  "spast",
  "spasti",
  "spasten",
  "missgeburt",
  "missgeburten",
  "nazi",
  "nazis",
  "hitler",
  "heil hitler",
  "sieg heil",
  "schwanz",
  "zigeuner",
  "schlitzauge",
  "judensau",
  "drecksau",
  "fick dich",
  "verpiss dich",
];

/** Roots matched at the start of any word: inflected and compound forms. */
const STEMS: readonly string[] = [
  // en
  "fuck",
  "motherfuck",
  "shit",
  "cunt",
  "nigg",
  "fagg",
  "bitch",
  "whore",
  "slut",
  "wank",
  // hu
  "fasz",
  "kurv",
  "geci",
  "baszd",
  "bazd",
  "baszo",
  "baszt",
  "kibasz",
  "elbasz",
  "megbasz",
  "segg",
  "buzi",
  "köcsög",
  "picsa",
  "szopd",
  // de
  "arsch",
  "fick",
  "wichs",
  "fotz",
  "scheiß",
  "schlamp",
  "spast",
  "nazi",
  "hitler",
];

/**
 * The Scunthorpe whitelist: innocent words a stem would catch, and phrases
 * that contain a listed word. These words are never blocked.
 */
const ALLOWED: readonly string[] = [
  // en
  "shitake",
  "shiitake",
  "niggle",
  "niggles",
  "niggling",
  "niggard",
  "niggardly",
  "fickle",
  "pina colada",
  // hu: fa + sz… compounds (wood + …)
  "faszén",
  "faszerkezet",
  "faszerkezetes",
  "faszobor",
  "faszék",
  "faszálka",
  "faszállítás",
  "kurvatúra",
  // de
  "faszination",
  "faszinierend",
  "faszinieren",
  "faszinosum",
  "nazionale",
];

/** Lowercase, accents and other combining marks removed, ß → ss. */
export function fold(text: string): string {
  return text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase().replaceAll("ß", "ss");
}

/** The words of a folded text: runs of letters and digits. */
const words = (text: string): string[] =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Phrases (as word lists) by their first word, for a quick lookup per word. */
function byFirstWord(entries: readonly string[]): Map<string, string[][]> {
  const index = new Map<string, string[][]>();
  for (const entry of entries) {
    const phrase = words(entry);
    const [first] = phrase;
    if (first === undefined) continue;
    index.set(first, [...(index.get(first) ?? []), phrase]);
  }
  return index;
}

const BLOCKED = byFirstWord([...SEED.en, ...SEED.hu, ...SEED.de, ...ADDED]);
const WHITELIST = byFirstWord(ALLOWED);
const FOLDED_STEMS = STEMS.map(fold);

/** The lengths of the phrases in `index` that start at word `at`. */
function matchesAt(index: Map<string, string[][]>, name: string[], at: number): number[] {
  return (index.get(name[at] ?? "") ?? [])
    .filter((phrase) => phrase.every((word, i) => name[at + i] === word))
    .map((phrase) => phrase.length);
}

/** Whether the Room name holds a blocked word or phrase. */
export function hasBlockedWord(name: string): boolean {
  const list = words(name);
  const allowed = new Set<number>();
  list.forEach((_, at) => {
    for (const length of matchesAt(WHITELIST, list, at)) {
      for (let i = at; i < at + length; i++) allowed.add(i);
    }
  });
  return list.some(
    (word, at) =>
      matchesAt(BLOCKED, list, at).some((length) =>
        Array.from({ length }, (_, i) => at + i).some((i) => !allowed.has(i)),
      ) ||
      (!allowed.has(at) && FOLDED_STEMS.some((stem) => word.startsWith(stem))),
  );
}
