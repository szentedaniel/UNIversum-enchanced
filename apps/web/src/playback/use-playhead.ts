/**
 * The push's Playback playhead on this client's clock (ADR-0004): `elapsedMs`
 * since the push arrived, re-read at every step boundary so the dice and the
 * Chance card show for their own step only. Timers, never animation frames: a
 * hidden tab throttles frames, and a late wake catches up to where the
 * Playback now is instead of replaying the steps it missed.
 */
import { useEffect, useMemo, useState } from "react";
import { timelineOf } from "#playback/timeline.ts";
import type { Push } from "#stores/room-store.ts";

export type Playhead = {
  /** The push (`Push.seq`) the playhead belongs to. */
  seq: number;
  /** How far its Playback has run, in ms from the push's arrival. */
  elapsedMs: number;
};

/** The moments one push's DOM must re-read: the end of every step that lasts. */
function stepEnds(push: Push): number[] {
  const ends: number[] = [];
  for (const step of timelineOf(push.events)) {
    if (step.durationMs > 0) ends.push(step.startMs + step.durationMs);
  }
  return ends;
}

/** The Playback's position for `push`, or `null` before the first push or its first tick. */
export function usePlayhead(push: Push | null): Playhead | null {
  const ends = useMemo(() => (push ? stepEnds(push) : []), [push]);
  const [reached, setReached] = useState<Playhead | null>(null);

  useEffect(() => {
    if (!push || ends.length === 0) return undefined;
    let timer = 0;
    const advance = () => {
      const elapsedMs = Date.now() - push.receivedAt;
      setReached({ seq: push.seq, elapsedMs });
      const next = ends.find((endMs) => endMs > elapsedMs);
      if (next !== undefined) timer = window.setTimeout(advance, next - elapsedMs + 1);
    };
    // From a timer, not the effect body, so the render stays pure.
    timer = window.setTimeout(advance, 0);
    return () => window.clearTimeout(timer);
  }, [push, ends]);

  // A position from the previous push never plays over the new one's timeline.
  return push && reached?.seq === push.seq ? reached : null;
}
