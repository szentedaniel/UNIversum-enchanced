import type { LobbyMessage } from "@universum/protocol/messages";
import type { PlayerName } from "@universum/rules";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { Lobby } from "#screens/Lobby.tsx";
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

// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written. The screens read
// their store through `useStore`; this hands them the state the store holds,
// as a mounted client reads it. No DOM environment is installed (#224).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

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

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
  vi.unstubAllGlobals();
});

/** The Lobby as the route draws it: the address carries the Room code. */
function renderLobby(): string {
  // The invite card reads the page's origin; Node has no window.
  vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/room/123456" },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/room/:code", element: createElement(Lobby) }),
      ),
    ),
  );
}

/** The Lobby as a client in it sees it: joined, with its latest Lobby message written. */
const showLobby = (me: string | null, lobby = lobbyOf()): string => {
  roomStore.setState({ status: "connected", code: lobby.code, me });
  receiveLobby(lobby, 0);
  return renderLobby();
};

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
    receiveRejection("NOT_OFFERED");
    markIntentSent();
    receiveLobby(lobbyOf(), 0);
    // A Lobby write with no game before it is a plain update: no game to drop.
    expect(roomStore.getState().push).toBeNull();
    expect(roomStore.getState().sentAt).not.toBeNull();
    expect(roomStore.getState().rejection?.code).toBe("NOT_OFFERED");
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

  it("leaves the Lobby no push to send it back to the game screen", () => {
    pushGame();
    receiveLobby(lobbyOf(), 0);
    // Lobby.tsx starts the game screen only while a push is held (`started`).
    expect(roomStore.getState().push).toBeNull();
  });
});

describe("the next game", () => {
  it("accepts a first push whose version is lower than the game it replaced", () => {
    receivePush({ view: viewOf(undefined, { version: 9 }), events: [], reveals: [], now: 0 }, 0);
    receiveLobby(lobbyOf(), 0);
    // A new game restarts `version` at its own start: the dropped push must not
    // turn the guard against it.
    receivePush(
      { view: viewOf(undefined, { version: 1 }), events: [], reveals: [], now: 0 },
      1_000,
    );

    expect(roomStore.getState().push?.view.version).toBe(1);
    expect(inLobbyOf(roomStore.getState())).toBe(false);
  });

  it("starts its Event log empty", () => {
    logStore.setState({ lines: [{ seq: 1, index: 0, text: "A dobás 3 + 4." }], cursor: null });
    pushGame();
    receiveLobby(lobbyOf(), 0);
    receivePush(
      { view: viewOf(undefined, { version: 1 }), events: [], reveals: [], now: 0 },
      1_000,
    );

    expect(logStore.getState().lines).toEqual([]);
    expect(playbackStore.getState().frame?.seq).toBe(roomStore.getState().push?.seq);
  });
});

describe("the released-Seat view", () => {
  it("shows the Lobby's open Seats and no Start button to a Guest whose Seat was released", () => {
    inLanguage("en");
    const html = showLobby("p3");

    expect(html).toContain('data-testid="room-code"');
    // Two Seats of the four are taken; the returned Lobby still offers the rest.
    expect(html.match(/data-open/g) ?? []).toHaveLength(2);
    expect(html).toContain('data-testid="seat-released"');
    expect(html).toContain("Your Seat was released");
    expect(html).toContain('data-testid="take-seat"');
    expect(html).toContain("Take a Seat");
    expect(html).not.toContain(">Start<");
    // A Guest without a Seat cannot place a Bot either.
    expect(html).not.toContain("Add Bot");
  });

  it("keeps the Start button and the Bot controls for a seated Guest", () => {
    inLanguage("en");
    const html = showLobby("p1");

    expect(html).toContain(">Start<");
    expect(html).toContain("Add Bot");
    expect(html).not.toContain('data-testid="seat-released"');
    expect(html).not.toContain('data-testid="take-seat"');
  });
});
