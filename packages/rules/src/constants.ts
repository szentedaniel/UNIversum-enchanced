/** Game constants (spec: Rules, parity yardstick). Amounts are in forints. */

/** Cash each Player starts with (R7). */
export const START_CASH = 2_500_000;

/** Paid by the Bank for passing or landing on Start (R10, R73). */
export const ROUND_BONUS = 250_000;

export const MINUTE_MS = 60_000;

/** The Turn timer every client shows: 20 s per decision (F22, R17). */
export const TURN_LIMIT_MS = 20_000;

/**
 * Extra time the server allows past the ring for client animations and lag
 * (spec: Clocks). Clients never show it.
 */
export const TURN_SLACK_MS = 3_000;

/** The `turnDeadline` of a decision that starts at `now`. */
export const turnDeadlineFrom = (now: number): number => now + TURN_LIMIT_MS + TURN_SLACK_MS;

/** Above this much cash the Timeout penalty is 10% of cash (R19). */
export const TIMEOUT_PENALTY_THRESHOLD = 100_000;

/** The Timeout penalty at or below the threshold, raised by Auto-sell first (R19). */
export const LOW_CASH_TIMEOUT_PENALTY = 100_000;

/** Quarantine rounds a Player sits out after landing on the Quarantine Field (R39). */
export const QUARANTINE_ROUNDS = 3;

/** The price of a PCR test bought in Quarantine (R43). */
export const PCR_TEST_PRICE = 200_000;

/** The only roll that frees a Player in Quarantine, and how far it moves them (R24, R42). */
export const QUARANTINE_ESCAPE_ROLL = 12;
