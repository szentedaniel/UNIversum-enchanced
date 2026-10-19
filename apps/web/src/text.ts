/**
 * Every visible string comes from a Paraglide message (hu/en/de). The server
 * sends ids, codes and numbers; these maps turn them into text. Dynamic keys
 * go through typed maps of message functions, so each message stays
 * tree-shakeable and a missing one fails to compile.
 */
import type { RejectionCode } from "@universum/protocol/messages";
import type { PlayerName } from "@universum/rules";
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
  MALFORMED: m.rejection_malformed,
  INTERNAL: m.rejection_internal,
  ROOM_NOT_FOUND: m.rejection_room_not_found,
  ROOM_FULL: m.rejection_room_full,
  ROOM_NAME_INVALID: m.rejection_room_name_invalid,
  WRONG_PASSWORD: m.rejection_wrong_password,
};

export const rejectionText = (code: RejectionCode): string => REJECTIONS[code]();

/** A Room name; `null` (left empty by its creator) gets one made from the Room code. */
export const roomNameText = (name: string | null, code: string): string =>
  name ?? m.room_name_generated({ code });

/** Money in full, in the active language's number format. */
export const formatMoney = (amount: number): string =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  }).format(amount);

export { m };
