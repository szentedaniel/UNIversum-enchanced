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
] as const;

export type RulesRejectionCode = (typeof RULES_REJECTION_CODES)[number];

export type Rejection = { code: RulesRejectionCode };

export const rejection = (code: RulesRejectionCode): Rejection => ({ code });
