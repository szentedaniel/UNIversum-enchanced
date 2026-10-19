import { randomInt } from "node:crypto";

/** Codes of the Rooms alive in this process; a code is never reissued while in use. */
const live = new Set<string>();

/**
 * A new 6-digit Room code (100000–999999, R4) that no live Room uses. The
 * code is reserved at once, so two Rooms created at the same moment never
 * share one; `releaseRoomCode` frees it when the Room is disposed.
 * The SQLite store (#34) adds "not still stored" to `isTaken`.
 */
export function reserveRoomCode(isTaken: (code: string) => boolean = () => false): string {
  for (;;) {
    const code = String(randomInt(100_000, 1_000_000));
    if (!live.has(code) && !isTaken(code)) {
      live.add(code);
      return code;
    }
  }
}

export function releaseRoomCode(code: string): void {
  live.delete(code);
}
