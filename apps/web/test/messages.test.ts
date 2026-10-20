import { describe, expect, it } from "vitest";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };

const LOCALES = ["hu", "en", "de"] as const;
type Messages = Record<string, string>;

// `$schema` is the file's metadata, not a message; it is ignored below.
const messages: Record<(typeof LOCALES)[number], Messages> = { hu, en, de };

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1] ?? "")
    .toSorted((a, b) => a.localeCompare(b));

describe("the message files", () => {
  it("have the same keys in Hungarian, English and German, none of them empty", () => {
    const keys = Object.keys(messages.en)
      .filter((key) => key !== "$schema")
      .toSorted((a, b) => a.localeCompare(b));
    for (const locale of LOCALES) {
      const localeKeys = Object.keys(messages[locale])
        .filter((key) => key !== "$schema")
        .toSorted((a, b) => a.localeCompare(b));
      expect(localeKeys).toEqual(keys);
      const empty = Object.entries(messages[locale]).filter(
        ([key, text]) => key !== "$schema" && text.trim() === "",
      );
      expect(empty).toEqual([]);
    }
  });

  it("use the same placeholders in every language", () => {
    for (const [key, text] of Object.entries(messages.en)) {
      if (key === "$schema") continue;
      for (const locale of LOCALES) {
        expect(placeholders(messages[locale][key] ?? "")).toEqual(placeholders(text));
      }
    }
  });

  it("name each language in that language, so a Guest finds their own", () => {
    for (const locale of LOCALES) {
      expect(messages[locale]["language_hu"]).toBe("Magyar");
      expect(messages[locale]["language_en"]).toBe("English");
      expect(messages[locale]["language_de"]).toBe("Deutsch");
    }
  });
});

/**
 * Every Hungarian string v1 shows (v1/client: gameConfig.js, the i18n files and
 * the hard-coded JSX), and where it lives now. `stem` is a word the cleaned-up
 * Hungarian keeps, so a key can't silently point at the wrong text. `dropped`
 * strings belong to v1 screens that v2 doesn't have.
 */
type V1String = { v1: string; key: string; stem: string } | { v1: string; dropped: string };

const V1_STRINGS: V1String[] = [
  // Field labels (gameConfig.js)
  { v1: "start", key: "field_start", stem: "Start" },
  { v1: "veszprém", key: "field_veszprem", stem: "Veszprém" },
  { v1: "budapest", key: "field_budapest", stem: "Budapest" },
  { v1: "debrecen", key: "field_debrecen", stem: "Debrecen" },
  { v1: "museum", key: "field_museum", stem: "Múzeum" },
  { v1: "Zürich", key: "field_zurich", stem: "Zürich" },
  { v1: "Paris", key: "field_paris", stem: "Párizs" },
  { v1: "edinburgh", key: "field_edinburgh", stem: "Edinburgh" },
  { v1: "Karantén", key: "field_quarantine", stem: "Karantén" },
  { v1: "chicago", key: "field_chicago", stem: "Chicago" },
  { v1: "austin", key: "field_austin", stem: "Austin" },
  { v1: "princeton", key: "field_princeton", stem: "Princeton" },
  { v1: "vienna", key: "field_vienna", stem: "Bécs" },
  { v1: "esély", key: "field_chance", stem: "Esély" },
  { v1: "berlin", key: "field_berlin", stem: "Berlin" },
  { v1: "Talár", key: "field_doubler", stem: "Talár" },
  { v1: "seattle", key: "field_seattle", stem: "Seattle" },
  { v1: "new haven", key: "field_new_haven", stem: "New Haven" },
  { v1: "london", key: "field_london", stem: "London" },
  { v1: "oxford", key: "field_oxford", stem: "Oxford" },
  { v1: "cambridge uk", key: "field_cambridge_uk", stem: "Cambridge (UK)" },
  { v1: "Erasmus", key: "field_erasmus", stem: "Erasmus" },
  { v1: "berkeley", key: "field_berkeley", stem: "Berkeley" },
  { v1: "new york", key: "field_new_york", stem: "New York" },
  { v1: "stanford", key: "field_stanford", stem: "Stanford" },
  { v1: "adó", key: "field_tax", stem: "Adó" },
  { v1: "cambridge us", key: "field_cambridge_us", stem: "Cambridge (USA)" },
  { v1: "Város", key: "field_kind_university", stem: "Egyetem" },
  // Chance cards (gameConfig.js)
  { v1: "Negatív PCR teszt", key: "chance_pcr_test_title", stem: "PCR" },
  {
    v1: "Nyertél egy negatív PCR tesztet amit legközelebb felhasználhatsz, ha karanténba jutsz.",
    key: "chance_pcr_test_text",
    stem: "felhasználhatsz",
  },
  { v1: "Nyeremény", key: "chance_scholarship_title", stem: "Nyeremény" },
  {
    v1: "Olyan jó átlagod lett, hogy 200 000 ft ösztöndíjban részesülsz.",
    key: "chance_scholarship_text",
    stem: "ösztöndíj",
  },
  { v1: "Minden tárgyól megbuktál", key: "chance_failed_exams_title", stem: "tárgyból" },
  {
    v1: "Sajnos minden tárgyadból megbuktál így 200 000 ft-ot kell fizetned, hogy újra felvehesd őket.",
    key: "chance_failed_exams_text",
    stem: "felvehesd",
  },
  // Panels (GameComponents/*.jsx)
  { v1: "Vásárlás", key: "offer_museum", stem: "Megveszem" },
  { v1: "Tandíj:", key: "field_card_rent", stem: "Tandíj" },
  {
    v1: "Minden birtokolt múzeum ennyi összeggel növeli a belépési díjat:",
    key: "offer_museum_hint",
    stem: "múzeum",
  },
  { v1: "Más játkosok ennyiért vehetik meg tőled:", key: "offer_buyout", stem: "Kivásárlás" },
  { v1: "Ráléptél az ADÓ mezőre", key: "event_tax_paid", stem: "adót" },
  { v1: "Fizetned kell … összeget", key: "event_tax_paid", stem: "fizetett" },
  { v1: "Megértettem", dropped: "acknowledgements are events (toasts), not clicks" },
  {
    v1: "Más játékos interakciót végez éppen...",
    dropped: "the others see whose Turn it is on the Turn card",
  },
  { v1: "Karanténban vagy még … körig.", key: "game_quarantine_rounds", stem: "karanténkörök" },
  { v1: "Válassz az opciók közül:", dropped: "the options are the buttons themselves" },
  { v1: "Dobj 12-t", key: "game_roll_for_twelve", stem: "12" },
  { v1: "Negatív PCR teszt vétele:", key: "game_buy_pcr_test", stem: "vásárlása" },
  { v1: "Negatív PCR tesztet felhasználása", key: "game_use_pcr_test", stem: "felhasználása" },
  {
    v1: "Jaj ne! Sajnos túl sokat jártál be előadásra és elkaptad a COVID-19 vírust.",
    key: "event_quarantine_entered",
    stem: "karantén",
  },
  { v1: "3 körből kimaradsz.", key: "event_quarantine_entered", stem: "kör" },
  { v1: "Lediplomáztál.", key: "doubler_title", stem: "Lediplomáztál" },
  {
    v1: "Jutalmul válassz ki egy várost, ahol ezentúl a tandíj MEGDUPLÁZÓDIK.",
    key: "doubler_prompt",
    stem: "MEGDUPLÁZÓDIK",
  },
  { v1: "Válassz egy mezőt", key: "pick_field", stem: "Válassz" },
  { v1: "Erasmusra mész.", key: "erasmus_title", stem: "Erasmusra" },
  {
    v1: "Válassz ki egy várost, ahova szeretnél menni.",
    key: "erasmus_prompt",
    stem: "menni",
  },
  { v1: "Válaszd ki a mezőket", key: "sale_pick_hint", stem: "kiválasztásához" },
  { v1: "Eladás", key: "sale_title", stem: "eladása" },
  { v1: "Automatikus", key: "sale_auto_sell", stem: "Automatikus" },
  { v1: "CSŐD", key: "game_bankrupt", stem: "CSŐD" },
  { v1: "győzelem", key: "game_over_won", stem: "Győzelem" },
  { v1: "Gratulálunk!!!", key: "game_over_congratulations", stem: "Gratulálunk" },
  { v1: "Csodás", dropped: "the podium needs no button to close" },
  // Lobby screens (LobbiesList.jsx, the i18n files)
  { v1: "Szobák", key: "rooms_title", stem: "várótermek" },
  { v1: "össz:", dropped: "the Lobby list shows the Lobbies, not a count" },
  { v1: "Játékosok a szobában", key: "lobby_players", stem: "Játékosok" },
  { v1: "Szoba készítése", key: "home_create", stem: "Szoba" },
  { v1: "Szoba neve", key: "create_room_name", stem: "neve" },
  { v1: "Szoba...", dropped: "the Room name field has a hint instead of a placeholder" },
  { v1: "Játékosok", key: "create_players", stem: "Játékosok" },
  { v1: "Idő", key: "create_minute_limit", stem: "Időkorlát" },
  { v1: "perc", key: "lobby_minute_limit", stem: "perc" },
  { v1: "Jelszó", key: "password_label", stem: "Jelszó" },
  { v1: "Csatlakozás a szobához", key: "home_join", stem: "Csatlakozás" },
  { v1: "Szobák mutatása", key: "home_lobby_list", stem: "Játék" },
  { v1: "Játssz most!", key: "home_lobby_list", stem: "keresése" },
  { v1: "VAGY", key: "home_or_join", stem: "vagy" },
  { v1: "NYELV", key: "language", stem: "Nyelv" },
  { v1: "Mentés", dropped: "picking a language applies it at once" },
  { v1: "Felhasználónév", dropped: "Players get a generated name (spec: Guest)" },
  { v1: "Nincs szobában", dropped: "v2 has no username screen outside a Room" },
];

describe("v1's Hungarian strings", () => {
  it.each(V1_STRINGS.filter((s) => "key" in s))("$v1 → $key", (entry) => {
    if (!("key" in entry)) return;
    expect(messages.hu[entry.key] ?? "").toContain(entry.stem);
  });
});
