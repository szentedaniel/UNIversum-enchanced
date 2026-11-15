import type { GameMessage, LobbyMessage } from "@universum/protocol/messages";
import type { PlayerName } from "@universum/rules";
import { beforeEach, describe, expect, it } from "vitest";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { logStore } from "#stores/log-store.ts";
import {
  inFlightOf,
  markIntentSent,
  receiveLobby,
  receivePush,
  receiveRejection,
  reset,
  roomStore,
  seatedMeOf,
} from "#stores/room-store.ts";
import { ROLL, viewOf } from "./playback-fixtures.ts";

// The room store's write interface (#127): one `seq` counter behind every
// answer, the never-back-to-an-older `version` guard and the in-flight lock.
// Only those functions write here; the store is read the way a screen reads it.

const push = (patch: { version?: number; now?: number } = {}, receivedAt = 0) => ({
  view: viewOf(undefined, { version: patch.version ?? 1 }),
  events: [],
  reveals: [],
  spectators: 0,
  now: patch.now ?? receivedAt,
});

beforeEach(reset);

describe("the answer's seq", () => {
  it("gives a Rejection a later seq than the push before it", () => {
    receivePush(push(), 0);
    receiveRejection("NOT_YOUR_TURN");
    expect(roomStore.getState().rejection!.seq).toBeGreaterThan(roomStore.getState().push!.seq);
  });

  it("gives a push a later seq than the Rejection before it", () => {
    receiveRejection("NOT_YOUR_TURN");
    receivePush(push(), 0);
    expect(roomStore.getState().push!.seq).toBeGreaterThan(roomStore.getState().rejection!.seq);
  });

  it("turns the server's clock into this client's offset", () => {
    receivePush(push({ now: 5_000 }), 4_000);
    expect(roomStore.getState().push).toMatchObject({ receivedAt: 4_000, clockOffset: 1_000 });
  });

  it("shows a push with the same version, as a rejoin sends the state again", () => {
    receivePush(push({ version: 2 }), 0);
    const first = roomStore.getState().push!.seq;
    receivePush(push({ version: 2 }), 1_000);
    expect(roomStore.getState().push!.view.version).toBe(2);
    expect(roomStore.getState().push!.receivedAt).toBe(1_000);
    expect(roomStore.getState().push!.seq).toBeGreaterThan(first);
  });

  it("ignores a push older than the one shown, without spending a seq", () => {
    receivePush(push({ version: 2 }), 0);
    const shown = roomStore.getState().push;
    receivePush(push({ version: 1 }), 1_000);
    expect(roomStore.getState().push).toEqual(shown);
    receiveRejection("NOT_YOUR_TURN");
    expect(roomStore.getState().rejection!.seq).toBeGreaterThan(shown!.seq);
  });
});

describe("a push that only changes the spectator count", () => {
  it("is accepted for the shown view and replays no event", () => {
    const view = viewOf(undefined, { version: 3 });
    receivePush({ view, events: [], reveals: [], spectators: 0, now: 0 }, 0);
    const before = roomStore.getState().push!;

    // A spectator joined the Room (spec #179, ticket #249): the same view and
    // no events, so the Playback has nothing to replay and the log gains no line.
    const countOnly: GameMessage = { view, events: [], reveals: [], spectators: 1, now: 0 };
    receivePush(countOnly, 1_000);

    const shown = roomStore.getState().push!;
    expect(shown.seq).toBeGreaterThan(before.seq);
    expect(shown.receivedAt).toBe(1_000);
    expect(shown.events).toEqual([]);
    expect(shown.reveals).toEqual([]);
    expect(playbackStore.getState().frame).toMatchObject({ eventsReached: 0, view });
    expect(logStore.getState().lines).toEqual([]);
  });
});

/** A Lobby message as the server sends it, with the given spectator count. */
const lobbyOf = (spectators: number): LobbyMessage => ({
  code: "123456",
  roomName: "tigrisek",
  creatorId: "p1",
  hasPassword: false,
  settings: {
    maxPlayers: 4,
    minuteLimit: 50,
    startingCash: 2_500_000,
    roundBonus: 250_000,
    turnLimitMs: 20_000,
  },
  seats: [{ playerId: "p1", name: { adjective: "happy", noun: "tiger" } satisfies PlayerName }],
  spectators,
  now: 1_000,
});

describe("the spectator count", () => {
  it("keeps the count a push carries, a count-only one included", () => {
    const view = viewOf(undefined, { version: 3 });
    receivePush({ view, events: [], reveals: [], spectators: 0, now: 0 }, 0);
    expect(roomStore.getState().spectators).toBe(0);

    // A Guest started watching (spec #179, ticket #249): the same view, no events.
    receivePush({ view, events: [], reveals: [], spectators: 2, now: 0 }, 1_000);
    expect(roomStore.getState().spectators).toBe(2);
  });

  it("keeps the running Playback when only the count changes", () => {
    const view = viewOf(undefined, { version: 3 });
    // Arrived now, so its Roll is still playing when the count arrives.
    const arrivedAt = Date.now();
    receivePush({ view, events: ROLL(), reveals: [], spectators: 0, now: 0 }, arrivedAt);
    const core = currentPlayback();
    const shown = roomStore.getState().push!;
    const reached = playbackStore.getState().frame?.eventsReached;
    expect(core).not.toBeNull();

    receivePush({ view, events: [], reveals: [], spectators: 3, now: 0 }, arrivedAt + 10);

    expect(roomStore.getState().spectators).toBe(3);
    expect(roomStore.getState().push!.seq).toBeGreaterThan(shown.seq);
    // Nothing is replayed: the same core at the same step of the Roll.
    expect(currentPlayback()).toBe(core);
    expect(playbackStore.getState().frame?.eventsReached).toBe(reached);
  });

  it("keeps the count a Lobby message carries", () => {
    receiveLobby(lobbyOf(3), 0);
    expect(roomStore.getState().spectators).toBe(3);
  });
});

describe("the in-flight lock", () => {
  it("is set by a send and cleared by a push with a later seq", () => {
    receivePush(push(), 0);
    markIntentSent();
    expect(inFlightOf(roomStore.getState())).toBe(true);
    receivePush(push(), 1_000);
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by a Rejection with a later seq", () => {
    receivePush(push(), 0);
    markIntentSent();
    receiveRejection("NOT_YOUR_TURN");
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is set with no answer yet and cleared by the first push", () => {
    markIntentSent();
    expect(inFlightOf(roomStore.getState())).toBe(true);
    receivePush(push(), 0);
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by reset", () => {
    receivePush(push(), 0);
    markIntentSent();
    reset();
    expect(roomStore.getState().push).toBeNull();
    expect(roomStore.getState().rejection).toBeNull();
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });
});

describe("the role", () => {
  it("is a Player until a watch records a spectator", () => {
    expect(roomStore.getState().role).toBe("player");
    roomStore.setState({ role: "spectator" });
    expect(seatedMeOf(roomStore.getState())).toBeNull();
  });

  it("reads a Player's own id, and nobody for a spectator, whatever the welcome said", () => {
    roomStore.setState({ me: "p1" });
    expect(seatedMeOf(roomStore.getState())).toBe("p1");
    // A watcher gets no welcome, and a stale `me` must not hand it a Seat's controls.
    roomStore.setState({ role: "spectator" });
    expect(seatedMeOf(roomStore.getState())).toBeNull();
  });

  it("goes back to a Player when the Room is left", () => {
    roomStore.setState({ role: "spectator" });
    reset();
    expect(roomStore.getState().role).toBe("player");
  });
});
