/**
 * The local Playback (ADR-0004): one push's events become ordered steps, each
 * with its start offset and duration from the rules' `PLAYBACK_MS` (durations
 * are never a second table). The Playback core reads these steps to say what
 * the whole screen shows at a moment — the dice, the cards, the toast and each
 * pawn — so they together run exactly as long as the server's `actsAfter` wait
 * (`playbackOf(events)`, the sum of every step's duration).
 *
 * A step's `kind` is its event's `overlay` from the presentation table: the
 * dice, a Chance card, the status-row toast, or nothing of its own (`Moved`
 * shows only on the Board).
 */
import type { EventOf, GameEvent } from "@universum/rules";
import { playbackOfEvent } from "@universum/rules/playback";
import { withOverlay, type Overlay } from "#playback/presentation.ts";

type TimedStep = {
  /** Where the step starts, in ms from the push's arrival. */
  startMs: number;
  /** How long it shows, in ms (`Moved` counts its Fields). */
  durationMs: number;
  kind: Overlay;
};

/**
 * A step of the Playback: `kind` is the single place that decides what the DOM
 * shows, and it fixes the event type that carries that content.
 */
export type PlaybackStep =
  | (TimedStep & { kind: "dice"; event: EventOf<"DiceRolled"> })
  | (TimedStep & { kind: "card"; event: EventOf<"CardDrawn"> })
  | (TimedStep & { kind: "toast"; event: GameEvent })
  | (TimedStep & { kind: "none"; event: GameEvent });

/** What the DOM shows for an event: the presentation table's `overlay`. */
function stepOf(event: GameEvent, startMs: number): PlaybackStep {
  return { ...withOverlay(event), startMs, durationMs: playbackOfEvent(event) };
}

/** One push's events as ordered steps, starting at 0. */
export function timelineOf(events: readonly GameEvent[]): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  let startMs = 0;
  for (const event of events) {
    const step = stepOf(event, startMs);
    steps.push(step);
    startMs += step.durationMs;
  }
  return steps;
}

/**
 * The step the DOM shows at `elapsedMs` from the push's arrival, or `null`
 * once the Playback has ended. A step is current from its start until its end:
 * the dice stop when the walk starts, and a zero-length step is never current.
 */
export function stepAt(steps: readonly PlaybackStep[], elapsedMs: number): PlaybackStep | null {
  for (const step of steps) {
    if (step.startMs > elapsedMs) break;
    if (elapsedMs < step.startMs + step.durationMs) return step;
  }
  return null;
}
