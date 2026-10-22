/**
 * The latest push's Playback frame, for the whole screen (ADR-0004, spec #63).
 * The core answers what is on screen at any client time; this store is the one
 * timer that asks it. It reads the frame when a push arrives and again just
 * past every boundary the core names (the end of each step and the Decision
 * gate), from timestamps — a hidden tab throttles animation frames, so a late
 * wake catches up to where the Playback now is.
 *
 * Every writer of `roomStore.push` (the connection and the test hooks) goes
 * through the subscription, and a new push replaces the old frame and timer.
 */
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { playbackOfPush, type Frame, type Playback, type TurnLabel } from "#playback/playback.ts";
import { roomStore } from "#stores/room-store.ts";

export type PlaybackState = {
  /** The latest push's frame, or `null` before the first push. */
  frame: Frame | null;
  /** When that push's decision opens, on this client's clock; `null` before the first push. */
  opensAt: number | null;
};

/** `playback()` in the test hooks: which push the gate is for, whether it is open, and the shown Turn. */
export type PlaybackGate = {
  seq: number | null;
  over: boolean;
  shownTurn: TurnLabel | null;
};

export const playbackStore = createStore<PlaybackState>()(
  subscribeWithSelector((): PlaybackState => ({ frame: null, opensAt: null })),
);

let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let current: Playback | null = null;

/**
 * The latest push's core, for a render loop that needs its own reading
 * (`frameAt(Date.now())` per animation frame). React reads the store's frame.
 */
export function currentPlayback(): Playback | null {
  return current;
}

/** Re-reads the latest push's frame and wakes once at its next boundary. */
function sync(): void {
  clearTimeout(wakeTimer);
  wakeTimer = undefined;
  const { push } = roomStore.getState();
  if (!push) {
    current = null;
    playbackStore.setState({ frame: null, opensAt: null });
    return;
  }
  const now = Date.now();
  // What the screen shows now is what it keeps showing until the new gate opens.
  const previousTurn = playbackStore.getState().frame?.shownTurn ?? null;
  const playback = playbackOfPush(push, previousTurn);
  current = playback;
  playbackStore.setState({ frame: playback.frameAt(now), opensAt: playback.opensAt });
  const next = playback.boundaries.find((at) => at > now);
  // A few ms past the boundary, so a tap never races the clock.
  if (next !== undefined) wakeTimer = setTimeout(sync, next - now + 20);
}

// The connection and the test hooks both write `roomStore.push`; one timer follows it.
roomStore.subscribe((state) => state.push, sync);
sync();
