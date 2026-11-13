/**
 * The cues follow the Playback (spec #178, ADR-0004): each frame says how many
 * of the push's events it has reached, and this module plays the cue of each
 * newly reached one, in order. A hidden tab's late wake can reach several
 * events at once, so none is dropped; the cursor keeps a repeated read or an
 * older push from playing anything, and a new push starts from its first event.
 * It never looks at a clock: the frame is the clock.
 */
import type { GameEvent } from "@universum/rules";
import { playCue } from "#audio.ts";
import type { Frame } from "#playback/playback.ts";
import { cuesReached } from "#sound/cues.ts";

/** The parts of a push the cues read. */
export type CuePush = {
  seq: number;
  events: readonly GameEvent[];
};

/** The parts of a Playback frame the cues read. */
export type CueFrame = Pick<Frame, "seq" | "eventsReached">;

/** The last push read and how many of its events have played; `null` before the first. */
let cursor: { seq: number; shown: number } | null = null;

/** One frame: plays the cues of the events it has reached that no frame played yet. */
export function syncCues(push: CuePush | null, frame: CueFrame | null): void {
  if (push === null || frame === null || frame.seq !== push.seq) return;
  // A frame left over from a push the cues have already passed plays nothing.
  if (cursor !== null && push.seq < cursor.seq) return;
  const from = cursor !== null && cursor.seq === push.seq ? cursor.shown : 0;
  const to = Math.min(Math.max(frame.eventsReached, 0), push.events.length);
  if (from >= to) {
    if (cursor === null || cursor.seq !== push.seq) cursor = { seq: push.seq, shown: to };
    return;
  }
  for (const cue of cuesReached(push.events, from, to)) playCue(cue);
  cursor = { seq: push.seq, shown: to };
}

/**
 * Forgets the cursor: leaving the Room and joining another restarts the push
 * `seq` counter, so the next Room's first push must not look older than the
 * last one read.
 */
export function resetCues(): void {
  cursor = null;
}
