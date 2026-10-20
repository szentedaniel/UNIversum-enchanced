/**
 * When the latest push's decision opens (ADR-0004). Two clocks must agree:
 * the local Playback of the push's events has run to its end on this client's
 * clock (the push's arrival plus `playbackOf(events)`), and the server's
 * `actsAfter` has passed by the server's clock. With no events (the first
 * view, a reconnect, a reload) only `actsAfter` applies.
 *
 * One store carries the answer for the whole screen: the Board's marks and the
 * decision controls in `Game.tsx` read it instead of keeping two copies of the
 * rule. It wakes once at the opening, from timestamps (never from animation
 * frames, which a hidden tab throttles).
 */
import type { GameEvent } from "@universum/rules";
import { playbackOf } from "@universum/rules/playback";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { roomStore } from "#stores/room-store.ts";

/** The parts of a push the gate reads. */
export type TimedPush = {
  view: { actsAfter: number };
  events: readonly GameEvent[];
  /** This client's clock when the push arrived. */
  receivedAt: number;
  /** The server's clock minus this client's, from the push. */
  clockOffset: number;
};

/** When the push's decision opens, on this client's clock: the later of the local Playback's end and `actsAfter`. */
export function decisionOpensAt(push: TimedPush): number {
  const playbackEnd = push.receivedAt + playbackOf(push.events);
  const actsAfter = push.view.actsAfter - push.clockOffset;
  return Math.max(playbackEnd, actsAfter);
}

export type PlaybackState = {
  /** The push (`Push.seq`) the gate is for; `null` before the first push. */
  seq: number | null;
  /** Whether that push's decision is open: its Playback and `actsAfter` have both passed. */
  over: boolean;
};

export const playbackStore = createStore<PlaybackState>()(
  subscribeWithSelector((): PlaybackState => ({ seq: null, over: true })),
);

let wakeTimer: ReturnType<typeof setTimeout> | undefined;

/** Re-reads the latest push, publishes `over`, and wakes once when it opens. */
function sync(): void {
  clearTimeout(wakeTimer);
  wakeTimer = undefined;
  const { push } = roomStore.getState();
  if (!push) {
    playbackStore.setState({ seq: null, over: true });
    return;
  }
  const leftMs = decisionOpensAt(push) - Date.now();
  playbackStore.setState({ seq: push.seq, over: leftMs <= 0 });
  // A few ms past the boundary, so a tap never races the clock.
  if (leftMs > 0) wakeTimer = setTimeout(sync, leftMs + 20);
}

// Every writer of `roomStore.push` (the connection and the test hooks) goes
// through here, so a new push closes the gate again and restarts its wait.
roomStore.subscribe((state) => state.push, sync);
sync();
