/**
 * The hint table (spec #180): one row per concept a first-time Guest meets,
 * each with a stable id, the message key its text lives under and a pure
 * trigger. A trigger reads the Decision module's answer — which is already
 * `null` while the Playback gate is shut, and only `owner: "me"` for the
 * viewer's own Offer, Quarantine choice, Sale and picks — plus the frame's
 * view, never a store, a timer or the wall clock. `nextHint` takes the store's
 * seen set and switch; the table order decides when two rows fire together.
 */
import type { PublicView } from "@universum/rules";
import type { OpenDecision } from "#decision/decision.ts";

/** A concept's stable id, the key the store remembers it by. */
export type HintId = "offer" | "quarantine" | "doubler" | "erasmus" | "sale" | "gameEnd";

/** The Paraglide key each row's one-sentence text lives under, in hu, en and de. */
export type HintMessageKey =
  | "hint_offer"
  | "hint_quarantine"
  | "hint_doubler"
  | "hint_erasmus"
  | "hint_sale"
  | "hint_game_end";

/** What a trigger reads: this client's open Decision and the push's view. */
export type HintContext = {
  decision: OpenDecision | null;
  view: PublicView;
};

export type HintRow = {
  id: HintId;
  messageKey: HintMessageKey;
  /** True when the viewer meets this concept now; pure and side-effect free. */
  trigger: (context: HintContext) => boolean;
};

/** The first hint to show, or `null`: the store's data and the screen's view. */
export type HintQuery = HintContext & {
  /** The hints this browser already showed. */
  seen: ReadonlySet<HintId>;
  /** The Guest's hints switch; off shows none. */
  enabled: boolean;
};

/** Whether the open Decision is the viewer's own, of `kind`. */
function mine(decision: OpenDecision | null, kind: OpenDecision["kind"]): boolean {
  return decision !== null && decision.owner === "me" && decision.kind === kind;
}

/** The viewer's Doubler or Erasmus pick, or `null`. */
function pickOf(decision: OpenDecision | null): "doubler" | "erasmus" | null {
  return decision !== null && decision.owner === "me" && decision.kind === "pick"
    ? decision.pick.kind
    : null;
}

/**
 * The rows in display order: an Offer, Quarantine, the Doubler pick, the
 * Erasmus pick, a Sale, and the game end the first own Roll opens. The ids are
 * persisted, so rename one only with a migration story for the seen set.
 */
export const HINTS: readonly HintRow[] = [
  {
    id: "offer",
    messageKey: "hint_offer",
    trigger: ({ decision }) => mine(decision, "offer"),
  },
  {
    id: "quarantine",
    messageKey: "hint_quarantine",
    trigger: ({ decision }) => mine(decision, "quarantine"),
  },
  {
    id: "doubler",
    messageKey: "hint_doubler",
    trigger: ({ decision }) => pickOf(decision) === "doubler",
  },
  {
    id: "erasmus",
    messageKey: "hint_erasmus",
    trigger: ({ decision }) => pickOf(decision) === "erasmus",
  },
  {
    id: "sale",
    messageKey: "hint_sale",
    trigger: ({ decision }) => mine(decision, "sale"),
  },
  {
    id: "gameEnd",
    messageKey: "hint_game_end",
    // The spec leaves the game-end trigger open; this table opens it at the
    // viewer's first own Roll. The phase check keeps the Podium hint-free even
    // if the Decision module ever answers during `gameOver`.
    trigger: ({ decision, view }) => view.phase.kind !== "gameOver" && mine(decision, "roll"),
  },
];

const KNOWN_IDS: ReadonlySet<string> = new Set(HINTS.map((row) => row.id));

/** Whether `value` is a hint id the table still knows; an old stored id is not. */
export function isHintId(value: unknown): value is HintId {
  return typeof value === "string" && KNOWN_IDS.has(value);
}

/** The first unseen hint this client meets now, or `null`. */
export function nextHint({ decision, view, seen, enabled }: HintQuery): HintRow | null {
  if (!enabled) return null;
  return HINTS.find((row) => !seen.has(row.id) && row.trigger({ decision, view })) ?? null;
}
