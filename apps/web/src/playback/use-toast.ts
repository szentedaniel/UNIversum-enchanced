/**
 * The status row's toast plays its push's Playback: each step with text shows
 * from its own start offset, on this client's clock, so the toast advances
 * event by event instead of showing only one event per push. A newer push
 * starts over on its own timeline (the toast's side of the jump to the end
 * that the Board does); a tab that was in the background catches up to the
 * latest step reached instead of queueing the ones it missed.
 */
import { useMemo } from "react";
import type { ToastCue } from "#playback/toast.ts";
import { cueAt, toastCues } from "#playback/toast.ts";
import { timelineOf } from "#playback/timeline.ts";
import { usePlayhead } from "#playback/use-playhead.ts";
import type { Push } from "#stores/room-store.ts";
import { eventText } from "#text.ts";

/** The step of the push's Playback the toast is showing, or `null` before the first. */
export function usePlaybackToast(push: Push | null): ToastCue | null {
  const cues = useMemo(
    () => (push ? toastCues(timelineOf(push.events), (event) => eventText(event, push.view)) : []),
    [push],
  );
  const playhead = usePlayhead(push);

  // A cue from the previous push never shows over the new one's timeline.
  return playhead ? cueAt(cues, playhead.elapsedMs) : null;
}
