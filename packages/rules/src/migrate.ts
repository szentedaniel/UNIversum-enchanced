/**
 * State migrations (spec: Migrations). The Room server stores the state after
 * every accepted intent; after a deploy that changes the state's shape it runs
 * every stored state through `migrate` on boot, before restoring the Room.
 */
import { START_CASH, TURN_LIMIT_MS, TURN_SLACK_MS } from "#constants.ts";
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
const MIGRATIONS: Readonly<Record<number, (state: StoredState) => StoredState>> = {
  // Version 2 adds `actsAfter` (ADR-0004). A running game carries on with no
  // wait: its current decision started when its deadline was counted, so the
  // Playback has already ended by then. A game that is over has no deadline;
  // its Playback is over too, so `endsAt` is a safe "now".
  1: (state) => {
    const deadline = state["turnDeadline"];
    return {
      ...state,
      stateVersion: 2,
      actsAfter:
        typeof deadline === "number" ? deadline - TURN_LIMIT_MS - TURN_SLACK_MS : state["endsAt"],
    };
  },
  // Version 3 adds the starting cash to the Room settings. A running game
  // keeps the cash its Players already hold: the setting only decides a new
  // game's starting cash, so today's value is the true default.
  2: (state) => {
    const settings = state["settings"];
    return {
      ...state,
      stateVersion: 3,
      settings: { ...(isObject(settings) ? settings : {}), startingCash: START_CASH },
    };
  },
  // Version 4 records which Players are Bots (ticket #196). A game stored
  // before Bots existed has none: every Player was a Guest.
  3: (state) => ({
    ...state,
    stateVersion: 4,
    players: playersOf(state).map((player) => Object.assign({}, player, { bot: false })),
  }),
  // Version 5 adds the pending Deal (spec #172). A game stored before Deals
  // existed has none: its current decision is the Player's own, and no Deal
  // was proposed this Turn.
  4: (state) => ({ ...state, stateVersion: 5, deal: null }),
  // Version 6 adds the Turn timer length to the Room settings (ticket #187).
  // A stored game's deadlines were counted with today's 20 s limit, so that
  // is its true value: the setting only decides the next decisions' deadlines.
  5: (state) => {
    const settings = state["settings"];
    return {
      ...state,
      stateVersion: 6,
      settings: { ...(isObject(settings) ? settings : {}), turnLimitMs: TURN_LIMIT_MS },
    };
  },
};

/**
 * Brings a stored state up to `STATE_VERSION`, one step at a time. Throws on a
 * state it can't place: no `stateVersion`, one from a newer server, or a gap
 * in the chain. The host then leaves that Room in the store untouched.
 */
export function migrate(stored: unknown): GameState {
  if (!isObject(stored)) throw new Error("not a stored state");
  let state = stored;
  for (;;) {
    const from = state["stateVersion"];
    if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
      throw new Error(`invalid stateVersion ${JSON.stringify(from)}`);
    }
    if (from > STATE_VERSION) {
      throw new Error(`stateVersion ${from} is newer than this server's ${STATE_VERSION}`);
    }
    if (isCurrent(state)) return state;
    const step = MIGRATIONS[from];
    if (!step) throw new Error(`no migration from stateVersion ${from}`);
    state = step(state);
  }
}

function isObject(value: unknown): value is StoredState {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Players of a stored state, as objects; a snapshot with none is not one we can migrate. */
function playersOf(state: StoredState): StoredState[] {
  const players = state["players"];
  if (!Array.isArray(players) || !players.every(isObject)) {
    throw new Error("a stored state has no Player list");
  }
  return players;
}

/** Trusted by version: every step and the snapshot fixtures keep the shape in line with it. */
function isCurrent(state: StoredState): state is GameState {
  return state["stateVersion"] === STATE_VERSION;
}
