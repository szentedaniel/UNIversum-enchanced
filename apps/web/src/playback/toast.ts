/**
 * The status-row toast's steps (ADR-0004): the Playback's steps that have text
 * to show, in order. A step without text (a walk, a Doubler placed) or with
 * nothing to show keeps the previous text up; the cause (a Chance card) comes
 * before its effect (the money).
 */
import type { GameEvent } from "@universum/rules";
import type { PlaybackStep } from "#playback/timeline.ts";

export type ToastCue = {
  /** Where the cue starts, in ms from the push's arrival. */
  startMs: number;
  event: GameEvent;
  /** Its text in the active language. */
  text: string;
};

/** The steps with text, in order: the toast shows each from its own start. */
export function toastCues(
  steps: readonly PlaybackStep[],
  textOf: (event: GameEvent) => string | null,
): ToastCue[] {
  const cues: ToastCue[] = [];
  for (const step of steps) {
    if (step.kind === "none") continue;
    const text = textOf(step.event);
    if (text === null) continue;
    cues.push({ startMs: step.startMs, event: step.event, text });
  }
  return cues;
}

/** The last cue that has started by `elapsedMs`; `null` before the first. */
export function cueAt(cues: readonly ToastCue[], elapsedMs: number): ToastCue | null {
  let shown: ToastCue | null = null;
  for (const cue of cues) {
    if (cue.startMs > elapsedMs) break;
    shown = cue;
  }
  return shown;
}
