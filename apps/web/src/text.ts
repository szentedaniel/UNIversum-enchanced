/**
 * Every visible string comes from a Paraglide message (hu/en/de). The server
 * sends ids, codes and numbers; these maps turn them into text. Dynamic keys
 * go through typed maps of message functions, so each message stays
 * tree-shakeable and a missing one fails to compile.
 */
import type { RejectionCode } from "@universum/protocol/messages";
import type { GameEvent, PlayerName, PublicView } from "@universum/rules";
import {
 CHANCE_CARD_MONEY,
 FIELDS,
 type ChanceCardId,
 type FieldKind,
} from "@universum/rules/board";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";

type Message = () => string;

/** Field names by the Board's Field key (`@universum/rules/board`). */
const FIELD_NAMES: Record<string, Message> = {
 start: m.field_start,
 veszprem: m.field_veszprem,
 budapest: m.field_budapest,
 debrecen: m.field_debrecen,
 museum1: m.field_museum,
 zurich: m.field_zurich,
 paris: m.field_paris,
 edinburgh: m.field_edinburgh,
 quarantine: m.field_quarantine,
 chicago: m.field_chicago,
 austin: m.field_austin,
 princeton: m.field_princeton,
 museum2: m.field_museum,
 vienna: m.field_vienna,
 chance1: m.field_chance,
 berlin: m.field_berlin,
 doubler: m.field_doubler,
 seattle: m.field_seattle,
 chance2: m.field_chance,
 newHaven: m.field_new_haven,
 museum3: m.field_museum,
 london: m.field_london,
 oxford: m.field_oxford,
 cambridgeUk: m.field_cambridge_uk,
 erasmus: m.field_erasmus,
 chance3: m.field_chance,
 berkeley: m.field_berkeley,
 newYork: m.field_new_york,
 museum4: m.field_museum,
 stanford: m.field_stanford,
 tax: m.field_tax,
 cambridgeUs: m.field_cambridge_us,
};

export const fieldName = (key: string): string => FIELD_NAMES[key]?.() ?? key;

const ADJECTIVES: Record<string, Message> = {
 brave: m.name_adj_brave,
 busy: m.name_adj_busy,
 calm: m.name_adj_calm,
 clever: m.name_adj_clever,
 cool: m.name_adj_cool,
 curious: m.name_adj_curious,
 eager: m.name_adj_eager,
 fancy: m.name_adj_fancy,
 gentle: m.name_adj_gentle,
 happy: m.name_adj_happy,
 jolly: m.name_adj_jolly,
 kind: m.name_adj_kind,
 lucky: m.name_adj_lucky,
 mighty: m.name_adj_mighty,
 nimble: m.name_adj_nimble,
 polite: m.name_adj_polite,
 proud: m.name_adj_proud,
 quick: m.name_adj_quick,
 quiet: m.name_adj_quiet,
 shy: m.name_adj_shy,
 sleepy: m.name_adj_sleepy,
 sunny: m.name_adj_sunny,
 tiny: m.name_adj_tiny,
 wise: m.name_adj_wise,
};

const NOUNS: Record<string, Message> = {
 badger: m.name_noun_badger,
 bear: m.name_noun_bear,
 beaver: m.name_noun_beaver,
 dolphin: m.name_noun_dolphin,
 eagle: m.name_noun_eagle,
 falcon: m.name_noun_falcon,
 fox: m.name_noun_fox,
 frog: m.name_noun_frog,
 hamster: m.name_noun_hamster,
 hare: m.name_noun_hare,
 hedgehog: m.name_noun_hedgehog,
 koala: m.name_noun_koala,
 lion: m.name_noun_lion,
 lynx: m.name_noun_lynx,
 moose: m.name_noun_moose,
 otter: m.name_noun_otter,
 owl: m.name_noun_owl,
 panda: m.name_noun_panda,
 parrot: m.name_noun_parrot,
 penguin: m.name_noun_penguin,
 raccoon: m.name_noun_raccoon,
 raven: m.name_noun_raven,
 tiger: m.name_noun_tiger,
 wolf: m.name_noun_wolf,
};

/** A Player name in the active language. */
export const playerName = (name: PlayerName): string =>
 `${ADJECTIVES[name.adjective]?.() ?? name.adjective} ${NOUNS[name.noun]?.() ?? name.noun}`;

const REJECTIONS: Record<RejectionCode, Message> = {
 STALE_TURN: m.rejection_stale_turn,
 NOT_YOUR_TURN: m.rejection_not_your_turn,
 NOT_OFFERED: m.rejection_not_offered,
 PLAYBACK_RUNNING: m.rejection_playback_running,
 SHORTFALL_NOT_COVERED: m.rejection_shortfall_not_covered,
 MALFORMED: m.rejection_malformed,
 INTERNAL: m.rejection_internal,
 ROOM_NOT_FOUND: m.rejection_room_not_found,
 ROOM_FULL: m.rejection_room_full,
 ROOM_NAME_INVALID: m.rejection_room_name_invalid,
 WRONG_PASSWORD: m.rejection_wrong_password,
 ROOM_NAME_BLOCKED: m.rejection_room_name_blocked,
 PASSWORD_LOCKED: m.rejection_password_locked,
 RATE_LIMITED: m.rejection_rate_limited,
 SERVER_BUSY: m.rejection_server_busy,
 SLOW_DOWN: m.rejection_slow_down,
};

export const rejectionText = (code: RejectionCode): string => REJECTIONS[code]();

const CHANCE_CARD_TEXTS: Record<ChanceCardId, { title: Message; text: Message }> = {
 pcrTest: { title: m.chance_pcr_test_title, text: m.chance_pcr_test_text },
 scholarship: {
  title: m.chance_scholarship_title,
  text: () => m.chance_scholarship_text({ amount: formatMoney(CHANCE_CARD_MONEY.scholarship) }),
 },
 failedExams: {
  title: m.chance_failed_exams_title,
  text: () => m.chance_failed_exams_text({ amount: formatMoney(-CHANCE_CARD_MONEY.failedExams) }),
 },
};

/** A Chance card's title and text in the active language. */
export const chanceCardText = (card: ChanceCardId): { title: string; text: string } => ({
 title: CHANCE_CARD_TEXTS[card].title(),
 text: CHANCE_CARD_TEXTS[card].text(),
});

/**
 * One Playback event as a line of text in the active language, or `null` for
 * an event with nothing to say (a walk, a Doubler placed). The status row
 * reads this map; the server never sends text.
 */
export function eventText(event: GameEvent, view: PublicView): string | null {
 const name = (id: string) => {
  const player = view.players.find((p) => p.id === id);
  return player ? playerName(player.name) : "";
 };
 switch (event.type) {
  case "DiceRolled":
   return m.event_dice_rolled({
    name: name(event.player),
    first: event.dice[0],
    second: event.dice[1],
   });
  case "RoundBonusPaid":
   return m.event_round_bonus({ name: name(event.player), amount: formatMoney(event.amount) });
  case "TimedOut":
   return m.event_timed_out({ name: name(event.player) });
  case "TimeoutPenaltyPaid":
   return m.event_timeout_penalty({
    name: name(event.player),
    amount: formatMoney(event.amount),
   });
  case "TurnPassed":
   return m.event_turn_passed({ name: name(event.player) });
  case "LevelBought":
   return m.event_level_bought({
    name: name(event.player),
    field: fieldName(FIELDS[event.field]?.key ?? ""),
    level: event.level,
    price: formatMoney(event.price),
   });
  case "OfferDeclined":
   return m.event_offer_declined({
    name: name(event.player),
    field: fieldName(FIELDS[event.field]?.key ?? ""),
   });
  case "RentPaid":
   return m.event_rent_paid({
    name: name(event.player),
    owner: name(event.owner),
    amount: formatMoney(event.amount),
   });
  case "MuseumBought":
   return m.event_museum_bought({
    name: name(event.player),
    field: fieldName(FIELDS[event.field]?.key ?? ""),
    price: formatMoney(event.price),
   });
  case "BoughtOut":
   return m.event_bought_out({
    name: name(event.player),
    owner: name(event.owner),
    field: fieldName(FIELDS[event.field]?.key ?? ""),
    price: formatMoney(event.price),
   });
  case "CardDrawn":
   return m.event_card_drawn({ name: name(event.player), ...chanceCardText(event.card) });
  case "ChanceMoneyReceived":
   return m.event_chance_money_received({
    name: name(event.player),
    amount: formatMoney(event.amount),
   });
  case "ChanceChargePaid":
   return m.event_chance_charge_paid({
    name: name(event.player),
    amount: formatMoney(event.amount),
   });
  case "TaxPaid":
   return m.event_tax_paid({ name: name(event.player), amount: formatMoney(event.amount) });
  case "QuarantineEntered":
   return m.event_quarantine_entered({ name: name(event.player), rounds: event.rounds });
  case "QuarantineRoundUsed":
   return m.event_quarantine_round_used({
    name: name(event.player),
    rounds: event.roundsLeft,
   });
  case "QuarantineReleased":
   return m.event_quarantine_released({ name: name(event.player) });
  case "PcrTestBought":
   return m.event_pcr_test_bought({
    name: name(event.player),
    amount: formatMoney(event.amount),
   });
  case "PcrTestUsed":
   return m.event_pcr_test_used({ name: name(event.player) });
  case "FieldsSold":
   return (event.auto ? m.event_auto_sold : m.event_fields_sold)({
    name: name(event.player),
    amount: formatMoney(event.amount),
   });
  case "WentBankrupt":
   return m.event_went_bankrupt({ name: name(event.player) });
  case "GameEnded":
   return m.event_game_ended({ name: name(event.winner) });
  default:
   return null;
 }
}

/** A Room name; `null` (left empty by its creator) gets one made from the Room code. */
export const roomNameText = (name: string | null, code: string): string =>
 name ?? m.room_name_generated({ code });

/** Money in full, in the active language's number format. */
export const formatMoney = (amount: number): string =>
 new Intl.NumberFormat(getLocale(), {
  style: "currency",
  currency: "HUF",
  // "Ft" in every language (English would otherwise write "HUF").
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 0,
 }).format(amount);

/** Money in short form for the Board's tiles (e.g. "1.2M"), in the active language. */
export const formatCompactMoney = (amount: number): string =>
 new Intl.NumberFormat(getLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(
  amount,
 );

const FIELD_KINDS: Record<FieldKind, Message> = {
 start: m.field_kind_start,
 university: m.field_kind_university,
 museum: m.field_kind_museum,
 chance: m.field_kind_chance,
 tax: m.field_kind_tax,
 quarantine: m.field_kind_quarantine,
 doubler: m.field_kind_doubler,
 erasmus: m.field_kind_erasmus,
};

/** A Field's kind ("University", "Museum", …) in the active language. */
export const fieldKindName = (kind: FieldKind): string => FIELD_KINDS[kind]();

export { m };
