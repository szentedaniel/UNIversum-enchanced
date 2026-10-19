/**
 * State migrations (spec: Migrations). The Room server stores the state after
 * every accepted intent; after a deploy that changes the state's shape it runs
 * every stored state through `migrate` on boot, before restoring the Room.
 */
import { STATE_VERSION, type GameState } from "#state.ts";

/** A stored state as JSON, before it is known to have the current shape. */
export type StoredState = Record<string, unknown>;

/**
 * `MIGRATIONS[n]` turns a state at `stateVersion` n into one at n + 1 (and
 * sets `stateVersion` to n + 1). Pure: no I/O, no clock, no randomness; a
 * value the old state lacks is derived from what it has.
 *
 * Version 1 is the first shape the server stored. When the shape changes,
 * bump `STATE_VERSION`, add the step here and commit a fixture of the new
 * shape (see test/migrate.test.ts).
 */
const MIGRATIONS: Readonly<Record<number, (state: StoredState) => StoredState>> = {};

/**
 * Brings a stored state up to `STATE_VERSION`, one step at a time. Throws on a
 * state it can't place: no `stateVersion`, one from a newer server, or a gap
 * in the chain. The host then leaves that Room in the store untouched.
 */
export function migrate(stored: unknown): GameState {
  if (stored === null || typeof stored !== "object") throw new Error("not a stored state");
  let state = stored as StoredState;
  for (;;) {
    const from = state["stateVersion"];
    if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
      throw new Error(`invalid stateVersion ${JSON.stringify(from)}`);
    }
    if (from > STATE_VERSION) {
      throw new Error(`stateVersion ${from} is newer than this server's ${STATE_VERSION}`);
    }
    if (from === STATE_VERSION) return state as GameState;
    const step = MIGRATIONS[from];
    if (!step) throw new Error(`no migration from stateVersion ${from}`);
    state = step(state);
  }
}
