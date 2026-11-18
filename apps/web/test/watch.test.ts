import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconnectOverlay } from "#components/ReconnectOverlay.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import type { LobbyMessage } from "@universum/protocol/messages";
import type { PlayerName } from "@universum/rules";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { Game } from "#screens/Game.tsx";
import { JoinByCode } from "#screens/join.tsx";
import { Lobby } from "#screens/Lobby.tsx";
import {
  receiveLobby,
  receivePush,
  reset,
  roomStore,
  type ConnectionStatus,
  type Role,
} from "#stores/room-store.ts";
import en from "../messages/en.json" with { type: "json" };
import { viewOf } from "./playback-fixtures.ts";

// Watching a Room (spec #179, stories 2–6): the Game screen a Guest without a
// Seat sees (the same Board, Player cards and Turn, with no way to play and a
// watching marker), the read-only Lobby it waits in with the spectator count,
// the Watch action beside Join, and the overlay that no longer promises a
// spectator a kept Seat. React's server renderer reads a zustand store's *initial*
// state, so this hands the screens the state the store holds, as a mounted client
// reads it; the media query and the PixiJS Board are the two things a server
// render cannot build. No DOM environment is installed (#224).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));
vi.mock("#lib/use-media-query.ts", () => ({ useWide: () => false, useMediaQuery: () => false }));
vi.mock("#board/Board.tsx", () => ({ Board: () => null }));

beforeEach(reset);

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
  vi.unstubAllGlobals();
});

/**
 * A running game joined as `role`, where it is p1's Turn and a Roll is due,
 * drawn by the route as the address `/game/123456` reaches it. `me` is what a
 * `welcome` would have written: a spectator gets none, and the role alone must
 * drop the controls.
 */
function showGame(role: Role, me: string | null, spectators = 0): string {
  roomStore.setState({ status: "connected", code: "123456", me, role });
  receivePush({ view: viewOf(), events: [], reveals: [], spectators, now: 0 }, 0);
  expect(currentPlayback()).not.toBeNull();
  expect(playbackStore.getState().frame?.gateOpen).toBe(true);
  return renderGame();
}

/** The Game screen as the route draws it, from the store's latest push. */
function renderGame(): string {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/game/123456" },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/game/:code", element: createElement(Game) }),
      ),
    ),
  );
}

describe("the watching Game screen", () => {
  it("draws the Board, the Player cards and the Turn, with a watching marker", () => {
    const html = showGame("spectator", null);

    expect(html).toContain('data-testid="watching"');
    expect(html).toContain(en.watching);
    expect(html).toContain('data-testid="turn-of"');
    expect(html).toContain('data-testid="minute-pill"');
    expect(html).toContain(en.game_players);
  });

  it("offers no Roll, Deal, Offer or pick control on a Player's Turn", () => {
    const html = showGame("spectator", null);

    expect(html).not.toContain(en.game_roll);
    expect(html).not.toContain(en.deal_open);
    expect(html).not.toContain('data-testid="deal-open"');
    expect(html).not.toContain('data-testid="offer"');
    expect(html).not.toContain('data-testid="sale-tray"');
    expect(html).not.toContain('data-testid="pick-tray"');
  });

  it("drops the Player-only controls even when a stale welcome named a Player", () => {
    const html = showGame("spectator", "p1");

    expect(html).toContain('data-testid="watching"');
    expect(html).not.toContain(en.game_roll);
    // Whose Turn it is, never "Your Turn".
    expect(html).not.toContain(en.game_your_turn);
    expect(html).toContain('data-testid="turn-of"');
  });

  it("gives a Player the Roll and no watching marker", () => {
    const html = showGame("player", "p1");

    expect(html).toContain(en.game_roll);
    expect(html).toContain(en.game_your_turn);
    expect(html).not.toContain('data-testid="watching"');
  });
});

/** A Lobby two Guests have taken Seats in, as its Lobby message carries it. */
const lobbyOf = (): LobbyMessage => ({
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
  seats: [
    { playerId: "p1", name: { adjective: "happy", noun: "tiger" } satisfies PlayerName },
    { playerId: "p2", name: { adjective: "calm", noun: "wolf" } satisfies PlayerName },
  ],
  spectators: 1,
  now: 1_000,
});

/** A Lobby a spectator reads: a Bot's Seat and a held Seat among the taken ones. */
const watchableLobby = (): LobbyMessage => ({
  ...lobbyOf(),
  seats: [
    { playerId: "p1", name: { adjective: "happy", noun: "tiger" } satisfies PlayerName },
    { playerId: "p2", name: { adjective: "calm", noun: "wolf" } satisfies PlayerName, bot: true },
    {
      playerId: "p3",
      name: { adjective: "brave", noun: "bear" } satisfies PlayerName,
      heldUntil: 61_000,
    },
  ],
  spectators: 2,
});

/** The Lobby as the route draws it, after the given role joined it and its message arrived. */
function showLobby(
  role: Role,
  me: string | null,
  status: ConnectionStatus = "connected",
  lobby: LobbyMessage = lobbyOf(),
): string {
  roomStore.setState({ status, code: lobby.code, me, role });
  receiveLobby(lobby, 0);
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: `/room/${lobby.code}` },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/room/:code", element: createElement(Lobby) }),
      ),
    ),
  );
}

describe("the watching Lobby screen", () => {
  beforeEach(() => {
    // The invite card reads the page's origin; Node has no window.
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  });

  it("draws the Lobby read-only, with a watching marker and the count", () => {
    const html = showLobby("spectator", null, "connected", watchableLobby());

    // The Room's own facts: name, code, taken Seats (Bot mark, held Seat), settings, invite.
    expect(html).toContain("tigrisek");
    expect(html).toContain('data-testid="room-code"');
    expect(html).toContain('data-testid="seat"');
    expect(html).toContain('data-testid="bot-mark"');
    expect(html).toContain('data-testid="seat-held"');
    expect(html).toContain("3/4");
    expect(html).toContain(en.lobby_no_password);
    expect(html).toContain('data-testid="invite-link"');
    // Who is watching, without a name, and the game still to come.
    expect(html).toContain('data-testid="watching"');
    expect(html).toContain(en.watching);
    expect(html).toContain("2 spectators");
    expect(html).toContain(en.watch_waiting);
  });

  it("offers a spectator no control that sends an intent", () => {
    const html = showLobby("spectator", null, "connected", watchableLobby());

    // The creator's crown stays (a fact of the Room), but nothing to press:
    // no Start, no Add/Remove Bot, no open Seat, no take-Seat, no release notice.
    expect(html).toContain(en.lobby_creator);
    expect(html).not.toContain(">Start<");
    expect(html).not.toContain(en.lobby_add_bot);
    expect(html).not.toContain(en.lobby_remove_bot);
    expect(html).not.toContain(en.lobby_open_seat);
    expect(html).not.toContain(en.lobby_waiting);
    expect(html).not.toContain(en.lobby_take_seat);
    expect(html).not.toContain('data-testid="take-seat"');
    expect(html).not.toContain('data-testid="seat-released"');
  });

  it("offers none either when a stale welcome named the creator as this client", () => {
    // The role, not the Player id, is what drops the controls (spec #179): a
    // spectator whose `me` happens to be the creator's must still press nothing.
    const html = showLobby("spectator", "p1", "connected", watchableLobby());

    expect(html).not.toContain(">Start<");
    expect(html).not.toContain(en.lobby_add_bot);
    expect(html).not.toContain(en.lobby_remove_bot);
    expect(html).not.toContain(en.lobby_take_seat);
    expect(html).not.toContain('data-testid="take-seat"');
  });

  it("marks no Seat as the spectator's own, even if a welcome named a Player", () => {
    const html = showLobby("spectator", "p1", "connected", watchableLobby());

    expect(html).not.toContain(en.lobby_you);
  });

  it("tells a spectator whose Room is gone that the connection was lost", () => {
    const html = showLobby("spectator", null, "lost");

    expect(html).toContain(en.connection_lost);
    expect(html).toContain('data-testid="reconnect-overlay"');
  });

  it("keeps the Lobby for a Player who took a Seat", () => {
    const html = showLobby("player", null);

    expect(html).not.toContain('data-testid="watching"');
    expect(html).toContain('data-testid="room-code"');
    expect(html).toContain('data-testid="seat"');
  });
});

describe("the spectator count on the Lobby", () => {
  beforeEach(() => {
    // The invite card reads the page's origin; Node has no window.
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  });

  it("shows nothing at zero", () => {
    const html = showLobby("player", "p1", "connected", { ...lobbyOf(), spectators: 0 });

    expect(html).not.toContain('data-testid="spectators"');
  });

  it("shows one spectator and many spectators, with a label of their number", () => {
    const one = showLobby("player", "p1", "connected", { ...lobbyOf(), spectators: 1 });
    expect(one).toContain('data-testid="spectators"');
    expect(one).toContain("1 spectator");

    reset();
    const many = showLobby("player", "p1", "connected", { ...lobbyOf(), spectators: 3 });
    expect(many).toContain('data-testid="spectators"');
    expect(many).toContain("3 spectators");
  });
});

describe("the spectator count in the Game", () => {
  it("shows nothing at zero", () => {
    expect(showGame("player", "p1")).not.toContain('data-testid="spectators"');
  });

  it("shows the count to a Player in the status row", () => {
    const html = showGame("player", "p1", 2);

    expect(html).toContain('data-testid="spectators"');
    expect(html).toContain("2 spectators");
  });

  it("updates from a push that carries no events", () => {
    const view = viewOf();
    roomStore.setState({ status: "connected", code: "123456", me: "p1", role: "player" });
    receivePush({ view, events: [], reveals: [], spectators: 0, now: 0 }, 0);
    expect(renderGame()).not.toContain('data-testid="spectators"');

    // A Spectator started watching (spec #179, ticket #249): the same view, no events.
    receivePush({ view, events: [], reveals: [], spectators: 2, now: 0 }, 1_000);
    expect(renderGame()).toContain("2 spectators");
  });
});

describe("the Watch action by a Room code", () => {
  it("sits beside Join in the Room code form", () => {
    const html = renderToStaticMarkup(createElement(StaticRouter, null, createElement(JoinByCode)));

    expect(html).toContain(en.home_join);
    expect(html).toContain(en.watch_button);
    expect(html).toContain('data-testid="watch"');
    // Nothing to send until the whole Room code is typed.
    expect(html).toContain('disabled=""');
  });
});

/** The reconnecting overlay as the Game screen mounts it, for a client of either role. */
function overlay(role: Role): string {
  roomStore.setState({ status: "reconnecting", role });
  return renderToStaticMarkup(createElement(StaticRouter, null, createElement(ReconnectOverlay)));
}

describe("the reconnecting overlay", () => {
  it("promises a kept Seat to a Player, and to nobody else", () => {
    expect(overlay("player")).toContain(en.reconnecting_hint);
    // A spectator holds no Seat (spec #179, story 6).
    expect(overlay("spectator")).not.toContain(en.reconnecting_hint);
    expect(overlay("spectator")).toContain(en.reconnecting);
  });
});
