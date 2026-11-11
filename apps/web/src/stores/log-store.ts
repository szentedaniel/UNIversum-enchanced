/**
 * The Event log's lines (#182), kept for the whole client: the Playback store
 * hands it every frame, and the panel reads it. The log is history, not UI
 * state: leaving or changing Room clears it with the room store's `reset()`.
 */
import { createStore } from "zustand/vanilla";
import { appendRevealed, emptyLog, type LogPush, type LogState } from "#playback/log.ts";
import type { Frame } from "#playback/playback.ts";

export const logStore = createStore<LogState>(() => emptyLog);

/**
 * One Playback frame: appends the lines of the events it has reached. A frame
 * for an older push, or a repeated read of the same events, adds nothing.
 */
export function syncLog(push: LogPush | null, frame: Frame | null): void {
  if (push === null || frame === null || frame.seq !== push.seq) return;
  const next = appendRevealed(logStore.getState(), push, frame.eventsReached);
  if (next !== logStore.getState()) logStore.setState(next);
}

/** Back to an empty history: a reload, leaving a Room or changing Room starts here. */
export function resetLog(): void {
  logStore.setState(emptyLog);
}
