import type { Scheduler } from "#room/scheduler.ts";
import type { RoomStore } from "#store/room-store.ts";

/** How long an ended Room and its events stay stored (spec: Retention). */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes an ended Room and its events `RETENTION_MS` after `endedAt` (at
 * once if that has passed), then runs `then`. Returns a cancel function.
 */
export function deleteAfterRetention(
  store: RoomStore,
  scheduler: Scheduler,
  code: string,
  endedAt: number,
  then: () => void = () => {},
): () => void {
  return scheduler.at(endedAt + RETENTION_MS, () => {
    store.delete(code);
    then();
  });
}
