import { randomInt } from "node:crypto";

/** Codes of the Rooms alive in this process; a code is never reissued while in use. */
const live = new Set<string>();

/**
 * A new 6-digit Room code (100000–999999, R4) that no live Room uses and
 * `isTaken` does not report (the store: a code still stored is never
 * reissued). The code is reserved at once, so two Rooms created at the same
 * moment never share one; `releaseRoomCode` frees it when the Room is disposed.
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

/** Reserves the code of a Room restored from the store. */
export function claimRoomCode(code: string): void {
  if (live.has(code)) throw new Error(`Room code ${code} is already live`);
  live.add(code);
}

export function releaseRoomCode(code: string): void {
  live.delete(code);
}
