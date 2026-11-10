/**
 * The engine's closed list of Rejection codes. A Rejection goes only to the
 * sender and is never stored. Add a code here when a rule needs one; the
 * protocol package's full list must include every code (checked at compile time),
 * and the web app needs a message for it in hu/en/de.
 */
export const RULES_REJECTION_CODES = [
  /** The intent's `turn` is not the current Turn (a double tap, a late tap). */
  "STALE_TURN",
  /** The sender is not the current Player (or a Player sent a system intent). */
  "NOT_YOUR_TURN",
  /** The intent is not one of the options the current phase offers. */
  "NOT_OFFERED",
  /** A Player intent arrived before the last intent's Playback ended (ADR-0004). */
  "PLAYBACK_RUNNING",
  /** The Fields picked in a Sale sell for less than the Shortfall (R66). */
  "SHORTFALL_NOT_COVERED",
  /** The Deal's recipient is the proposer, a Bankrupt Player, or nobody in the game. */
  "DEAL_RECIPIENT_INVALID",
  /** A Field in the Deal is not owned by the side that offers it (spec #172). */
  "DEAL_FIELD_NOT_OWNED",
  /** A Field appears more than once in the Deal (spec #172). */
  "DEAL_FIELD_REPEATED",
  /** The Deal moves neither a Field nor any cash (spec #172). */
  "DEAL_EMPTY",
  /** One side's cash does not cover what the Deal asks of it (spec #172). */
  "DEAL_CASH_NOT_COVERED",
] as const;

export type RulesRejectionCode = (typeof RULES_REJECTION_CODES)[number];

export type Rejection = { code: RulesRejectionCode };

export const rejection = (code: RulesRejectionCode): Rejection => ({ code });
