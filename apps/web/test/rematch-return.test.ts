import type { LobbyMessage } from "@universum/protocol/messages";
import type { PlayerName } from "@universum/rules";
import { beforeEach, describe, expect, it } from "vitest";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { logStore } from "#stores/log-store.ts";
import {
  inFlightOf,
  inLobbyOf,
  markIntentSent,
  receiveLobby,
  receivePush,
  receiveRejection,
  reset,
  roomStore,
} from "#stores/room-store.ts";
import { ROLL, viewOf } from "./playback-fixtures.ts";

// The return to the Lobby after a Rematch (spec #175, stories 4–7): the server
// sends a Lobby message instead of a game push, so the client drops the game it
// shows — the push, its Playback and the Event log — and keeps the Room's news.
// The Game screen leaves for `/room/:code` on that; a Guest whose Seat the
// Rematch released stays in the Room without one.

const NAME: PlayerName = { adjective: "happy", noun: "tiger" };

const SETTINGS = {
  maxPlayers: 4,
  minuteLimit: 50,
  startingCash: 2_500_000,
  roundBonus: 250_000,
  turnLimitMs: 20_000,
} as const;

/** A Lobby message as the server sends it: two Seats taken of four. */
const lobbyOf = (patch: Partial<LobbyMessage> = {}): LobbyMessage => ({
  code: "123456",
  roomName: "tigrisek",
  creatorId: "p1",
  hasPassword: false,
  settings: SETTINGS,
  seats: [
    { playerId: "p1", name: NAME },
    { playerId: "p2", name: NAME },
  ],
  now: 1_000,
  ...patch,
});

/** A game push with a Roll, as the last thing a Podium client saw. */
const pushGame = (): void => {
  receivePush({ view: viewOf(), events: ROLL(), reveals: [], now: 0 }, 0);
};

beforeEach(reset);

describe("the Lobby message after a game", () => {
  it("drops the game push and the Playback frame it started", () => {
    pushGame();
    expect(playbackStore.getState().frame).not.toBeNull();
    expect(currentPlayback()).not.toBeNull();

    receiveLobby(lobbyOf(), 0);
    expect(roomStore.getState().push).toBeNull();
    expect(playbackStore.getState().frame).toBeNull();
    expect(currentPlayback()).toBeNull();
  });

  it("writes the Lobby with this client's clock offset", () => {
    pushGame();
    receiveLobby(lobbyOf({ now: 5_000 }), 4_000);
    expect(roomStore.getState().lobby).toEqual(lobbyOf({ now: 5_000 }));
    expect(roomStore.getState().lobbyClockOffset).toBe(1_000);
  });

  it("clears the in-flight lock, so the Lobby starts unlocked", () => {
    pushGame();
    markIntentSent();
    expect(inFlightOf(roomStore.getState())).toBe(true);

    receiveLobby(lobbyOf(), 0);
    expect(roomStore.getState().sentAt).toBeNull();
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("clears the Event log of the game that returned", () => {
    logStore.setState({ lines: [{ seq: 1, index: 0, text: "A dobás 3 + 4." }], cursor: null });
    pushGame();
    receiveLobby(lobbyOf(), 0);
    expect(logStore.getState().lines).toEqual([]);
  });

  it("keeps the Rejection the Podium showed", () => {
    pushGame();
    receiveRejection("REMATCH_NOT_OFFERED");
    receiveLobby(lobbyOf(), 0);
    expect(roomStore.getState().rejection?.code).toBe("REMATCH_NOT_OFFERED");
  });

  it("leaves the answers alone when no game was shown, as a rejoin to a Lobby sends one", () => {
    receiveLobby(lobbyOf(), 0);
    expect(roomStore.getState().push).toBeNull();
    // A Lobby write with no game before it is a plain update: nothing to drop.
    expect(logStore.getState().lines).toEqual([]);
    expect(roomStore.getState().lobby?.code).toBe("123456");
  });
});

describe("the screen's news", () => {
  it("reads a Lobby, not a game, once the return cleared the push", () => {
    pushGame();
    expect(inLobbyOf(roomStore.getState())).toBe(false);

    receiveLobby(lobbyOf(), 0);
    expect(inLobbyOf(roomStore.getState())).toBe(true);
  });
});
