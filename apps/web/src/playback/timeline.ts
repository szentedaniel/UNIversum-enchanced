/**
 * The local Playback (ADR-0004): one push's events become ordered steps, each
 * with its start offset and duration from the rules' `PLAYBACK_MS` — never a
 * table of its own. The Board's animation queue and the DOM layer both play
 * these steps, so the pawn, the dice, the cards and the toast stay in step and
 * together run exactly as long as the server's `actsAfter` wait
 * (`playbackOf(events)`, the sum of every step's duration).
 *
 * A step's `kind` says what the DOM shows for it: the dice, a Chance card, the
 * status-row toast, or nothing of its own (`Moved` shows only on the Board).
 */
import type { GameEvent } from "@universum/rules";
import { PLAYBACK_MS } from "@universum/rules/playback";

export type StepKind = "dice" | "card" | "toast" | "none";

export type PlaybackStep = {
  event: GameEvent;
  /** Where the step starts, in ms from the push's arrival. */
  startMs: number;
  /** How long it shows, in ms (`Moved` counts its Fields). */
  durationMs: number;
  kind: StepKind;
};

/** An event's length: the shared constant, `Moved` scaled by its Fields. */
const durationOf = (event: GameEvent): number =>
  event.type === "Moved" ? event.steps * PLAYBACK_MS.Moved : PLAYBACK_MS[event.type];

/** What the DOM shows for a step; a step with no length has nothing to show. */
function kindOf(event: GameEvent, durationMs: number): StepKind {
  switch (event.type) {
    case "DiceRolled":
      return "dice";
    case "CardDrawn":
      return "card";
    case "Moved":
      return "none";
    default:
      return durationMs > 0 ? "toast" : "none";
  }
}

/** One push's events as ordered steps, starting at 0. */
export function timelineOf(events: readonly GameEvent[]): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  let startMs = 0;
  for (const event of events) {
    const durationMs = durationOf(event);
    steps.push({ event, startMs, durationMs, kind: kindOf(event, durationMs) });
    startMs += durationMs;
  }
  return steps;
}
