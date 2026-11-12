/**
 * The sound cues (spec #178): one named cue per effect file, and one
 * exhaustive row per Game event type saying which cue it starts, or an
 * explicit `"none"`. A new event type fails to compile until someone decides
 * its sound, the way `playback/presentation.ts` forces its overlay and tone.
 *
 * The Playback decides when: `cue-sync.ts` plays the cues of the events a
 * frame has reached, so a sound starts with its step, never when a push
 * arrives.
 */
import type { GameEvent } from "@universum/rules";
import diceSound from "#assets/sounds/dice.mp3";

/** The effect file of every cue; a new sound adds a row here and a file beside it. */
export const CUES = {
  dice: diceSound,
} as const;

/** A named cue: one effect file from `CUES`. */
export type CueName = keyof typeof CUES;

/** The table's shape: one row per event type, its cue or `"none"`. */
export type CueTable = { [T in GameEvent["type"]]: CueName | "none" };

export const EVENT_CUES: CueTable = {
  DiceRolled: "dice",
  Moved: "none",
  RoundBonusPaid: "none",
  LevelBought: "none",
  MuseumBought: "none",
  BoughtOut: "none",
  OfferDeclined: "none",
  RentPaid: "none",
  CardDrawn: "none",
  ChanceMoneyReceived: "none",
  ChanceChargePaid: "none",
  ChanceTransferPaid: "none",
  TaxPaid: "none",
  QuarantineEntered: "none",
  QuarantineRoundUsed: "none",
  QuarantineReleased: "none",
  PcrTestBought: "none",
  PcrTestUsed: "none",
  FieldsSold: "none",
  WentBankrupt: "none",
  TimedOut: "none",
  TimeoutPenaltyPaid: "none",
  DoublerPlaced: "none",
  DealProposed: "none",
  DealAccepted: "none",
  DealDeclined: "none",
  DealExpired: "none",
  GameEnded: "none",
  TurnPassed: "none",
};

/**
 * The cues of the events in `[from, to)`, in order. A range beyond the events
 * is clamped, and a silent event contributes nothing.
 */
export function cuesReached(events: readonly GameEvent[], from: number, to: number): CueName[] {
  const cues: CueName[] = [];
  const start = Math.max(from, 0);
  const end = Math.min(to, events.length);
  for (let index = start; index < end; index += 1) {
    const event = events[index];
    if (!event) continue;
    const cue = EVENT_CUES[event.type];
    if (cue !== "none") cues.push(cue);
  }
  return cues;
}
