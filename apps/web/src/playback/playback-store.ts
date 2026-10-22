/**
 * The latest push's Playback frame, for the whole screen (ADR-0004, spec #63).
 * The core answers what is on screen at any client time; this store is the one
 * timer that asks it. A new push builds its core once and publishes its frame;
 * from then on the timer re-reads that same core just past every boundary it
 * names (the end of each step and the Decision gate), from timestamps — a
 * hidden tab throttles animation frames, so a late wake catches up to where
 * the Playback now is.
 *
 * Every writer of `roomStore.push` (the connection and the test hooks) goes
 * through the subscription, and a new push replaces the old frame and timer.
 */
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { playbackOfPush, type Frame, type Playback, type TurnLabel } from "#playback/playback.ts";
import { roomStore } from "#stores/room-store.ts";

/** The latest push's frame, or `null` before the first push. */
export type PlaybackState = {
  frame: Frame | null;
};

/** `playback()` in the test hooks: which push the gate is for, whether it is open, and the shown Turn. */
export type PlaybackGate = {
  seq: number | null;
  gateOpen: boolean;
  shownTurn: TurnLabel | null;
};

export const playbackStore = createStore<PlaybackState>()(
  subscribeWithSelector((): PlaybackState => ({ frame: null })),
);

/**
 * Whether the latest push's decision is open. Before the first push there is
 * no frame and nothing to wait for, so the gate is open: a screen with no
 * push shows no Playback (the old gate store defaulted the same way).
 */
export function gateOpenOf(state: PlaybackState): boolean {
  return state.frame?.gateOpen ?? true;
}

let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let current: Playback | null = null;

/**
 * The latest push's core, for a render loop that needs its own reading
 * (`frameAt(Date.now())` per animation frame). It is the same object for the
 * whole life of a push, so a render loop may hold it; React reads the store.
 */
export function currentPlayback(): Playback | null {
  return current;
}

/** Arms the one wake-up at the next boundary after `now`. */
function armNext(playback: Playback, now: number): void {
  const next = playback.boundaries.find((at) => at > now);
  // A few ms past the boundary, so a tap never races the clock.
  if (next !== undefined) wakeTimer = setTimeout(wake, next - now + 20);
}

/** Publishes the core's frame at `now`, then waits for the next boundary. */
function publish(playback: Playback, now: number): void {
  playbackStore.setState({ frame: playback.frameAt(now) });
  armNext(playback, now);
}

/** A boundary was reached: re-read the same push's core. */
function wake(): void {
  wakeTimer = undefined;
  if (current) publish(current, Date.now());
}

/** A new push: build its core once, from the Turn the screen shows now. */
function start(): void {
  clearTimeout(wakeTimer);
  wakeTimer = undefined;
  const { push } = roomStore.getState();
  if (!push) {
    current = null;
    playbackStore.setState({ frame: null });
    return;
  }
  // The previous push's shown Turn is what this one holds until its gate opens.
  const previousTurn = playbackStore.getState().frame?.shownTurn ?? null;
  current = playbackOfPush(push, previousTurn);
  publish(current, Date.now());
}

// The connection and the test hooks both write `roomStore.push`; one timer follows it.
roomStore.subscribe((state) => state.push, start);
start();
