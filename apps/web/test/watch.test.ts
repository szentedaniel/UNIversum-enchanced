import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { Game } from "#screens/Game.tsx";
import { receivePush, reset, roomStore, type Role } from "#stores/room-store.ts";
import en from "../messages/en.json" with { type: "json" };
import { viewOf } from "./playback-fixtures.ts";

// The watching Game screen (spec #179, stories 2, 3 and 5): a Guest without a
// Seat sees the same Board, Player cards and Turn as a Player, with no way to
// play. React's server renderer reads a zustand store's *initial* state, so
// this hands the screens the state the store holds, as a mounted client reads
// it; the media query and the PixiJS Board are the two things a server render
// cannot build. No DOM environment is installed (#224).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));
vi.mock("#lib/use-media-query.ts", () => ({ useWide: () => false, useMediaQuery: () => false }));
vi.mock("#board/Board.tsx", () => ({ Board: () => null }));

beforeEach(reset);

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => inLanguage(baseLocale));

/**
 * A running game joined as `role`, where it is p1's Turn and a Roll is due,
 * drawn by the route as the address `/game/123456` reaches it. `me` is what a
 * `welcome` would have written: a watcher gets none, and the role alone must
 * drop the controls.
 */
function showGame(role: Role, me: string | null): string {
  roomStore.setState({ status: "connected", code: "123456", me, role });
  receivePush({ view: viewOf(), events: [], reveals: [], now: 0 }, 0);
  expect(currentPlayback()).not.toBeNull();
  expect(playbackStore.getState().frame?.gateOpen).toBe(true);
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
