/**
 * The Playback step the DOM is showing: the dice for their own 450 ms, the
 * drawn Chance card for its 7 s, then each effect in turn (ADR-0004). Both
 * overlays read this, so they can never show two steps at once or outlive
 * their step into the next decision.
 */
import { useMemo } from "react";
import { stepAt, timelineOf, type PlaybackStep } from "#playback/timeline.ts";
import { usePlayhead } from "#playback/use-playhead.ts";
import type { Push } from "#stores/room-store.ts";

/** The step under the playhead, or `null` before it starts or once the Playback has ended. */
export function usePlaybackStep(push: Push | null): PlaybackStep | null {
  const steps = useMemo(() => (push ? timelineOf(push.events) : []), [push]);
  const playhead = usePlayhead(push);
  return playhead ? stepAt(steps, playhead.elapsedMs) : null;
}
