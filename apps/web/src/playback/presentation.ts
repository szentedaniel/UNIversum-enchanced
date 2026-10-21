/**
 * How each event is shown (ADR-0004, spec #63). One exhaustive table says, per
 * event type, what the screen shows for it (`overlay`), whether its toast is a
 * notice or routine (`tone`), and its line of text. This is the only place
 * that decides those; the Playback lengths stay rules data in
 * `@universum/rules/playback`, and a new event type fails to compile until it
 * has a row here.
 *
 * `overlay: "none"` makes a hidden event explicit: a walk, a Turn passing and
 * a declined offer have no layer of their own (and, today, no length).
 * `text` is absent for an event that has nothing to say; the status row keeps
 * the previous line up through it.
 */
import type { EventOf, GameEvent, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import { chanceCardText, fieldName, formatMoney, m, playerName } from "#text.ts";

/** What the DOM shows for an event (`none` = only the Board, if anything). */
export type Overlay = "dice" | "card" | "toast" | "none";

/** The toast's sticker: a notice gets the accent one, routine events the plain one. */
export type Tone = "notice" | "routine";

/** One event type's presentation: its overlay, tone and (when it has one) its line. */
export type Presentation<T extends GameEvent["type"]> = {
  overlay: Overlay;
  tone: Tone;
  /** The toast's line in the active language, typed for this event. */
  text?: (event: EventOf<T>, view: PublicView) => string;
};

/** A Player's name in the active language; `""` when the view does not carry them. */
function nameOf(view: PublicView, id: string): string {
  const player = view.players.find((p) => p.id === id);
  return player ? playerName(player.name) : "";
}

/** A Field's name from its id on the Board. */
const fieldOf = (field: number): string => fieldName(FIELDS[field]?.key ?? "");

/** The table's shape: one row per event type, its `text` typed for that event. */
export type PresentationTable = { [T in GameEvent["type"]]: Presentation<T> };

export const EVENT_PRESENTATION: PresentationTable = {
  DiceRolled: {
    overlay: "dice",
    tone: "routine",
    text: (event, view) =>
      m.event_dice_rolled({
        name: nameOf(view, event.player),
        first: event.dice[0],
        second: event.dice[1],
      }),
  },
  Moved: { overlay: "none", tone: "routine" },
  RoundBonusPaid: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_round_bonus({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  LevelBought: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_level_bought({
        name: nameOf(view, event.player),
        field: fieldOf(event.field),
        level: event.level,
        price: formatMoney(event.price),
      }),
  },
  MuseumBought: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_museum_bought({
        name: nameOf(view, event.player),
        field: fieldOf(event.field),
        price: formatMoney(event.price),
      }),
  },
  BoughtOut: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_bought_out({
        name: nameOf(view, event.player),
        owner: nameOf(view, event.owner),
        field: fieldOf(event.field),
        price: formatMoney(event.price),
      }),
  },
  OfferDeclined: { overlay: "none", tone: "routine" },
  RentPaid: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) =>
      m.event_rent_paid({
        name: nameOf(view, event.player),
        owner: nameOf(view, event.owner),
        amount: formatMoney(event.amount),
      }),
  },
  CardDrawn: {
    overlay: "card",
    tone: "notice",
    text: (event, view) =>
      m.event_card_drawn({ name: nameOf(view, event.player), ...chanceCardText(event.card) }),
  },
  ChanceMoneyReceived: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_chance_money_received({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  ChanceChargePaid: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_chance_charge_paid({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  TaxPaid: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) =>
      m.event_tax_paid({ name: nameOf(view, event.player), amount: formatMoney(event.amount) }),
  },
  QuarantineEntered: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) =>
      m.event_quarantine_entered({ name: nameOf(view, event.player), rounds: event.rounds }),
  },
  QuarantineRoundUsed: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) =>
      m.event_quarantine_round_used({
        name: nameOf(view, event.player),
        rounds: event.roundsLeft,
      }),
  },
  QuarantineReleased: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) => m.event_quarantine_released({ name: nameOf(view, event.player) }),
  },
  PcrTestBought: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) =>
      m.event_pcr_test_bought({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  PcrTestUsed: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) => m.event_pcr_test_used({ name: nameOf(view, event.player) }),
  },
  FieldsSold: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      (event.auto ? m.event_auto_sold : m.event_fields_sold)({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  WentBankrupt: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) => m.event_went_bankrupt({ name: nameOf(view, event.player) }),
  },
  TimedOut: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) => m.event_timed_out({ name: nameOf(view, event.player) }),
  },
  TimeoutPenaltyPaid: {
    overlay: "toast",
    tone: "routine",
    text: (event, view) =>
      m.event_timeout_penalty({
        name: nameOf(view, event.player),
        amount: formatMoney(event.amount),
      }),
  },
  DoublerPlaced: { overlay: "toast", tone: "routine" },
  GameEnded: {
    overlay: "toast",
    tone: "notice",
    text: (event, view) => m.event_game_ended({ name: nameOf(view, event.winner) }),
  },
  TurnPassed: { overlay: "none", tone: "routine" },
};

/**
 * The table's row for one event type, with its `text` still typed for that
 * event (the table's annotation is what keeps the row and the event in step).
 */
export function presentationOf<T extends GameEvent["type"]>(type: T): Presentation<T> {
  return EVENT_PRESENTATION[type];
}

/** The toast's tone for an event; the status row turns a notice into the accent sticker. */
export function toneOf(event: GameEvent): Tone {
  return presentationOf(event.type).tone;
}

/**
 * An event together with the overlay the table gives it: a `dice` overlay
 * carries a `DiceRolled`, a `card` overlay a `CardDrawn`, so a component can
 * read the dice or the card without narrowing on the event again.
 */
export type OverlaidEvent =
  | { kind: "dice"; event: EventOf<"DiceRolled"> }
  | { kind: "card"; event: EventOf<"CardDrawn"> }
  | { kind: "toast"; event: GameEvent }
  | { kind: "none"; event: GameEvent };

/** The event with its overlay; the table is the only place that pairs them. */
export function withOverlay(event: GameEvent): OverlaidEvent {
  // The table's only `dice` row is `DiceRolled` and its only `card` row is
  // `CardDrawn` (`presentation.test.ts` pins both), so the overlay fixes the
  // payload. TypeScript cannot follow a table lookup; the assertion states
  // that invariant once, here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a `dice` overlay is a `DiceRolled`, a `card` overlay a `CardDrawn`.
  return { kind: presentationOf(event.type).overlay, event } as OverlaidEvent;
}

/** The toast line for an event, or `null` when it has none and the previous line stays up. */
export function eventText(event: GameEvent, view: PublicView): string | null {
  return presentationOf(event.type).text?.(event, view) ?? null;
}
