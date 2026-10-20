/**
 * The status row's toast plays its push's Playback: each step with text shows
 * from its own start offset, on this client's clock, so the toast advances
 * event by event instead of showing only one event per push. A newer push
 * starts over on its own timeline (the toast's side of the jump to the end
 * that the Board does); a tab that was in the background catches up to the
 * latest step reached instead of queueing the ones it missed.
 */
import { useEffect, useMemo, useState } from "react";
import type { ToastCue } from "#playback/toast.ts";
import { cueAt, toastCues } from "#playback/toast.ts";
import { timelineOf } from "#playback/timeline.ts";
import type { Push } from "#stores/room-store.ts";
import { eventText } from "#text.ts";

/** The step of the push's Playback the toast is showing, or `null` before the first. */
export function usePlaybackToast(push: Push | null): ToastCue | null {
  const cues = useMemo(
    () => (push ? toastCues(timelineOf(push.events), (event) => eventText(event, push.view)) : []),
    [push],
  );
  const [reached, setReached] = useState<{ seq: number; elapsedMs: number } | null>(null);

  useEffect(() => {
    if (!push || cues.length === 0) return undefined;
    let timer = 0;
    const advance = () => {
      const elapsedMs = Date.now() - push.receivedAt;
      setReached({ seq: push.seq, elapsedMs });
      const next = cues.find((cue) => cue.startMs > elapsedMs);
      if (next) timer = window.setTimeout(advance, next.startMs - elapsedMs + 1);
    };
    // From a timer, not the effect body, so the render stays pure.
    timer = window.setTimeout(advance, 0);
    return () => window.clearTimeout(timer);
  }, [push, cues]);

  // A cue from the previous push never shows over the new one's timeline.
  return push && reached?.seq === push.seq ? cueAt(cues, reached.elapsedMs) : null;
}
