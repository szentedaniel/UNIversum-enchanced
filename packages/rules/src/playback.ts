/**
 * Playback (ADR-0004): how long the events of an accepted intent take to show.
 * The engine stores `actsAfter = ctx.now + playbackOf(events)` and counts the
 * next Turn's deadline from it; clients play the same event list with the same
 * lengths. These are rules constants: changing an animation's length is a
 * rules change, so the server's wait and the client's Playback can't drift.
 *
 * The table lists every event type (a new event fails to compile until it has
 * a length). `Moved` is the hop of one Field, so `playbackOf` scales it by the
 * event's `steps`.
 */
import type { GameEvent } from "#events.ts";

/** The dice, shown before the pawn moves. */
const DICE_MS = 450;
/** One Field of a `Moved` hop. */
const STEP_MS = 160;
/** A drawn Chance card, long enough for everyone to read it. */
const CARD_MS = 7_000;
/** A money change or a notice shown as one quick step. */
const BEAT_MS = 600;
/** Events with nothing to show cost no time. */
const NOTHING_MS = 0;

/**
 * How long each event takes to show, in ms. `Moved` is per Field stepped:
 * multiply it by the event's `steps` (which `playbackOf` does).
 */
export const PLAYBACK_MS: Readonly<Record<GameEvent["type"], number>> = {
 DiceRolled: DICE_MS,
 Moved: STEP_MS,
 RoundBonusPaid: BEAT_MS,
 LevelBought: BEAT_MS,
 MuseumBought: BEAT_MS,
 BoughtOut: BEAT_MS,
 OfferDeclined: NOTHING_MS,
 RentPaid: BEAT_MS,
 CardDrawn: CARD_MS,
 ChanceMoneyReceived: BEAT_MS,
 ChanceChargePaid: BEAT_MS,
 TaxPaid: BEAT_MS,
 QuarantineEntered: BEAT_MS,
 QuarantineRoundUsed: BEAT_MS,
 QuarantineReleased: BEAT_MS,
 PcrTestBought: BEAT_MS,
 PcrTestUsed: BEAT_MS,
 FieldsSold: BEAT_MS,
 WentBankrupt: BEAT_MS,
 TimedOut: BEAT_MS,
 TimeoutPenaltyPaid: BEAT_MS,
 DoublerPlaced: BEAT_MS,
 GameEnded: BEAT_MS,
 TurnPassed: NOTHING_MS,
};

/** The Playback length of an event list in ms: the sum of its events, `Moved` by its steps. */
export function playbackOf(events: readonly GameEvent[]): number {
 let total = 0;
 for (const event of events) {
  total += event.type === "Moved" ? event.steps * PLAYBACK_MS.Moved : PLAYBACK_MS[event.type];
 }
 return total;
}
