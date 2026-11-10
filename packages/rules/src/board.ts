/**
 * Static Board data: the only runtime values the web app may import from the
 * rules package (`@universum/rules/board`). Keep this file free of rule logic
 * and of imports from the rest of the engine. Level prices land here with the
 * Universities (#26).
 */

/** Number of Fields on the Board. */
export const FIELD_COUNT = 32;

/** A Field's index on the ring, 0 (Start) to 31. */
export type FieldId = number;

export type FieldKind =
  | "start"
  | "university"
  | "museum"
  | "chance"
  | "tax"
  | "quarantine"
  | "doubler"
  | "erasmus";

/** A University Group, 1 to 8. */
export type GroupId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type FieldInfo = {
  readonly id: FieldId;
  /** Stable key; the web app maps it to a Paraglide message for the Field name. */
  readonly key: string;
  readonly kind: FieldKind;
  /** The University's Group; `null` for every other Field (the Quarantine Field too, F1). */
  readonly group: GroupId | null;
  /**
   * A University's Value at each Level, indexed by Level: 0 (unbuilt, worth 0)
   * to `MAX_LEVEL` (R25–R27). `null` for every other Field.
   */
  readonly values: readonly number[] | null;
};

/** The highest Level of a University (R25). */
export const MAX_LEVEL = 4;

/**
 * A Museum's price and Value, the same for every owner (R53, F2 fixed). Museums
 * have no Levels.
 */
export const MUSEUM_VALUE = 400_000;

/** Value by Level as tenths of the base price: 1.0 B, 1.2 B, 1.6 B, 2.2 B (R27). */
const VALUE_TENTHS = [0, 10, 12, 16, 22] as const;

/** Universities seen so far, so `f` can number them 1–20 in ring order. */
let universities = 0;

/** The n-th University's Values: base `B = 200,000 + (n − 1) × 20,000` (R26). */
function universityValues(): readonly number[] {
  universities += 1;
  const base = 200_000 + (universities - 1) * 20_000;
  return VALUE_TENTHS.map((tenths) => (base * tenths) / 10);
}

const f = (id: FieldId, key: string, kind: FieldKind, group: GroupId | null = null): FieldInfo => ({
  id,
  key,
  kind,
  group,
  values: kind === "university" ? universityValues() : null,
});

/** The 32 Fields in ring order (v1 `gameConfig.js`, with the F1 fix). */
export const FIELDS: readonly FieldInfo[] = [
  f(0, "start", "start"),
  f(1, "veszprem", "university", 1),
  f(2, "budapest", "university", 1),
  f(3, "debrecen", "university", 1),
  f(4, "museum1", "museum"),
  f(5, "zurich", "university", 2),
  f(6, "paris", "university", 2),
  f(7, "edinburgh", "university", 2),
  f(8, "quarantine", "quarantine"),
  f(9, "chicago", "university", 3),
  f(10, "austin", "university", 3),
  f(11, "princeton", "university", 3),
  f(12, "museum2", "museum"),
  f(13, "vienna", "university", 4),
  f(14, "chance1", "chance"),
  f(15, "berlin", "university", 4),
  f(16, "doubler", "doubler"),
  f(17, "seattle", "university", 5),
  f(18, "chance2", "chance"),
  f(19, "newHaven", "university", 5),
  f(20, "museum3", "museum"),
  f(21, "london", "university", 6),
  f(22, "oxford", "university", 6),
  f(23, "cambridgeUk", "university", 6),
  f(24, "erasmus", "erasmus"),
  f(25, "chance3", "chance"),
  f(26, "berkeley", "university", 7),
  f(27, "newYork", "university", 7),
  f(28, "museum4", "museum"),
  f(29, "stanford", "university", 8),
  f(30, "tax", "tax"),
  f(31, "cambridgeUs", "university", 8),
];

/** The Start Field, where the Round bonus is paid. */
export const START_FIELD: FieldId = 0;

/**
 * The Chance cards, in v1's order first (R32): a PCR test, a +200,000
 * scholarship and a −200,000 fee for failing every exam, then the university
 * cards. The web app maps each id to its Paraglide title and text.
 */
export const CHANCE_CARDS = [
  "pcrTest",
  "scholarship",
  "failedExams",
  "textbookFair",
  "teachingAssistantJob",
] as const;

export type ChanceCardId = (typeof CHANCE_CARDS)[number];

/** What each Chance card pays (+) or charges (−) the Player who draws it (R34). */
export const CHANCE_CARD_MONEY: Readonly<Record<ChanceCardId, number>> = {
  pcrTest: 0,
  scholarship: 200_000,
  failedExams: -200_000,
  textbookFair: -150_000,
  teachingAssistantJob: 300_000,
};
