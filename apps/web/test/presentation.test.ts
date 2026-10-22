import type { GameEvent, PublicView } from "@universum/rules";
import { PLAYBACK_MS } from "@universum/rules/playback";
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import {
  EVENT_PRESENTATION,
  eventText,
  toneOf,
  type Overlay,
  type Tone,
} from "#playback/presentation.ts";
import { viewOf } from "./playback-fixtures.ts";

// The presentation table (spec #63): one exhaustive row per event type saying
// what it shows (the dice, a Chance card, a toast or nothing), whether its
// toast is a notice or routine, and its line of text. Nothing else decides
// these. A new event type fails to compile until it has a row, and this test
// fails until the row is pinned here.

/** One sample of every event type, so a row's `text` can be called. */
const SAMPLES = {
  DiceRolled: { type: "DiceRolled", player: "p1", dice: [3, 4] },
  Moved: { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
  RoundBonusPaid: { type: "RoundBonusPaid", player: "p1", amount: 200_000 },
  LevelBought: { type: "LevelBought", player: "p1", field: 3, level: 2, price: 120_000 },
  MuseumBought: { type: "MuseumBought", player: "p1", field: 4, price: 360_000 },
  BoughtOut: { type: "BoughtOut", player: "p1", owner: "p2", field: 4, level: 1, price: 400_000 },
  OfferDeclined: { type: "OfferDeclined", player: "p1", field: 3 },
  RentPaid: { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
  CardDrawn: { type: "CardDrawn", player: "p1", card: "scholarship" },
  ChanceMoneyReceived: { type: "ChanceMoneyReceived", player: "p1", amount: 300_000 },
  ChanceChargePaid: { type: "ChanceChargePaid", player: "p1", amount: 200_000 },
  TaxPaid: { type: "TaxPaid", player: "p1", amount: 50_000 },
  QuarantineEntered: { type: "QuarantineEntered", player: "p1", rounds: 2 },
  QuarantineRoundUsed: { type: "QuarantineRoundUsed", player: "p1", roundsLeft: 1 },
  QuarantineReleased: { type: "QuarantineReleased", player: "p1" },
  PcrTestBought: { type: "PcrTestBought", player: "p1", amount: 100_000 },
  PcrTestUsed: { type: "PcrTestUsed", player: "p1" },
  FieldsSold: { type: "FieldsSold", player: "p1", fields: [3], amount: 100_000, auto: true },
  WentBankrupt: { type: "WentBankrupt", player: "p1", fields: [3] },
  TimedOut: { type: "TimedOut", player: "p1" },
  TimeoutPenaltyPaid: { type: "TimeoutPenaltyPaid", player: "p1", amount: 50_000 },
  DoublerPlaced: { type: "DoublerPlaced", player: "p1", field: 16, count: 1 },
  GameEnded: { type: "GameEnded", winner: "p1", reason: "lastPlayer" },
  TurnPassed: { type: "TurnPassed", player: "p2", turn: 2 },
} satisfies Record<GameEvent["type"], GameEvent>;

const isEventType = (key: string): key is GameEvent["type"] => key in SAMPLES;
const EVENT_TYPES = Object.keys(SAMPLES).filter(isEventType);

// The text helpers read only the Players' names; the rest is a view they never touch.
const VIEW: PublicView = viewOf();

/** Every event with what the screen shows for it: the table's only decision. */
const SHOWN: Record<GameEvent["type"], { overlay: Overlay; tone: Tone }> = {
  DiceRolled: { overlay: "dice", tone: "routine" },
  Moved: { overlay: "none", tone: "routine" },
  RoundBonusPaid: { overlay: "toast", tone: "routine" },
  LevelBought: { overlay: "toast", tone: "routine" },
  MuseumBought: { overlay: "toast", tone: "routine" },
  BoughtOut: { overlay: "toast", tone: "routine" },
  OfferDeclined: { overlay: "none", tone: "routine" },
  RentPaid: { overlay: "toast", tone: "notice" },
  CardDrawn: { overlay: "card", tone: "notice" },
  ChanceMoneyReceived: { overlay: "toast", tone: "routine" },
  ChanceChargePaid: { overlay: "toast", tone: "routine" },
  TaxPaid: { overlay: "toast", tone: "notice" },
  QuarantineEntered: { overlay: "toast", tone: "notice" },
  QuarantineRoundUsed: { overlay: "toast", tone: "notice" },
  QuarantineReleased: { overlay: "toast", tone: "notice" },
  PcrTestBought: { overlay: "toast", tone: "notice" },
  PcrTestUsed: { overlay: "toast", tone: "notice" },
  FieldsSold: { overlay: "toast", tone: "routine" },
  WentBankrupt: { overlay: "toast", tone: "notice" },
  TimedOut: { overlay: "toast", tone: "routine" },
  TimeoutPenaltyPaid: { overlay: "toast", tone: "routine" },
  DoublerPlaced: { overlay: "none", tone: "routine" },
  GameEnded: { overlay: "toast", tone: "notice" },
  TurnPassed: { overlay: "none", tone: "routine" },
};

const LOCALES: Locale[] = ["hu", "en", "de"];

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
});

describe("the presentation table", () => {
  it("lists every event type with its overlay and tone", () => {
    const listed = Object.fromEntries(
      EVENT_TYPES.map((type) => [
        type,
        { overlay: EVENT_PRESENTATION[type].overlay, tone: toneOf(SAMPLES[type]) },
      ]),
    );

    expect(listed).toEqual(SHOWN);
  });

  it("gives every event with a line a non-empty one in hu, en and de", () => {
    const withText = EVENT_TYPES.filter((type) => EVENT_PRESENTATION[type].text !== undefined);
    const empty = LOCALES.flatMap((locale) => {
      inLanguage(locale);
      return withText.filter((type) => !eventText(SAMPLES[type], VIEW)?.trim());
    });

    expect(empty).toEqual([]);
  });

  it("gives every toast entry a line", () => {
    const toasts = EVENT_TYPES.filter((type) => EVENT_PRESENTATION[type].overlay === "toast");
    const textless = toasts.filter((type) => EVENT_PRESENTATION[type].text === undefined);

    expect(textless).toEqual([]);
  });

  it("hides every event the rules give no length", () => {
    const noLength = EVENT_TYPES.filter((type) => PLAYBACK_MS[type] === 0);
    const shown = noLength.filter((type) => EVENT_PRESENTATION[type].overlay !== "none");

    expect(noLength).toEqual(["OfferDeclined", "TurnPassed"]);
    expect(shown).toEqual([]);
  });

  it("has no line for a walk, a Turn passing, a declined offer or a Doubler", () => {
    const textless = EVENT_TYPES.filter(
      (type) => EVENT_PRESENTATION[type].text === undefined,
    ).toSorted();

    expect(textless).toEqual(["DoublerPlaced", "Moved", "OfferDeclined", "TurnPassed"]);
  });

  it("returns null for those, so the previous line stays up", () => {
    inLanguage("en");
    for (const type of ["Moved", "TurnPassed", "OfferDeclined", "DoublerPlaced"] as const) {
      expect(eventText(SAMPLES[type], VIEW)).toBeNull();
    }
  });
});
