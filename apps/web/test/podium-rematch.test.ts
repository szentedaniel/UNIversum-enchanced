import type { PlayerView, PublicView } from "@universum/rules";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Podium } from "#components/Podium.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { podiumRematch } from "#pick/podium.ts";
import { inFlightOf, markIntentSent, receivePush, reset, roomStore } from "#stores/room-store.ts";
import { viewOf } from "./playback-fixtures.ts";

// The Podium's rematch vote (spec #175, stories 1–3): the button a seated
// Player presses and the chips that show who has agreed. The push carries the
// votes; the screen passes them to the Podium. A vote can arrive after the
// Podium opened (with no events), so the component never caches them.

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
});

beforeEach(reset);

const player = (id: string, seat: number, bot = false): PlayerView => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash: 0,
  wealth: 0,
  position: 0,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
  bot,
});

const GUESTS = [player("p1", 0), player("p2", 1), player("p3", 2)];

const PHASE = { kind: "gameOver", winner: "p1", reason: "timeUp" } as const;

/** A game-over view whose Players the test chooses. */
const gameOverView = (players: PlayerView[] = GUESTS): PublicView =>
  viewOf(undefined, {
    version: 7,
    phase: PHASE,
    players,
    standings: players.map((p) => ({ player: p.id, wealth: p.wealth })),
  });

/** A push as the server sends it: a game-over view and its vote list (absent while a game runs). */
const pushOf = (view: PublicView, rematch: readonly string[] | undefined) => ({
  view,
  events: [],
  reveals: [],
  now: 0,
  ...(rematch === undefined ? {} : { rematch }),
});

/** The Podium as the Game screen builds it, from the store's latest push. */
function renderPodium() {
  const state = roomStore.getState();
  const push = state.push;
  if (push === null) throw new Error("the test pushes a game-over view first");
  const { view } = push;
  if (view.phase.kind !== "gameOver") throw new Error("the test's push ends the game");
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/game/123456" },
      createElement(Podium, {
        view,
        phase: view.phase,
        rematch: push.rematch,
        me: state.me,
        busy: inFlightOf(state),
      }),
    ),
  );
}

/** The chip Players' ids, in the order the Podium draws them (the view's Seat order). */
const chipIds = (html: string) =>
  [...html.matchAll(/data-testid="rematch-chip" data-player="([^"]+)"/g)].map((match) => match[1]);

/** The button's own text. */
const buttonText = (html: string) =>
  /data-testid="rematch-button"[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? "";

/** The button's opening tag: Base UI writes `disabled` before the test id. */
const buttonTag = (html: string) =>
  /<button[^>]*data-testid="rematch-button"[^>]*>/.exec(html)?.[0] ?? "";

describe("the push's votes", () => {
  it("copies the rematch votes of the push into the store", () => {
    receivePush(pushOf(gameOverView(), ["p2", "p3"]), 0);
    expect(roomStore.getState().push?.rematch).toEqual(["p2", "p3"]);
  });

  it("replaces the votes when a vote push arrives with the same view version", () => {
    receivePush(pushOf(gameOverView(), ["p2"]), 0);
    // A vote changes no game state: the view's version stays put.
    receivePush(pushOf(gameOverView(), ["p2", "p1"]), 1_000);
    expect(roomStore.getState().push?.rematch).toEqual(["p2", "p1"]);
  });

  it("leaves the votes absent for a push without the key, as a running game sends", () => {
    receivePush(pushOf(gameOverView(), undefined), 0);
    expect(roomStore.getState().push?.rematch).toBeUndefined();
  });
});

describe("the Podium's rematch controls", () => {
  it("offers the rematch to a seated Player who has not agreed", () => {
    expect(podiumRematch(GUESTS, "p1", []).mine).toEqual({
      agreed: false,
      intent: { type: "Rematch" },
    });
  });

  it("offers the withdraw to a seated Player who has agreed", () => {
    expect(podiumRematch(GUESTS, "p2", ["p1", "p2"]).mine).toEqual({
      agreed: true,
      intent: { type: "WithdrawRematch" },
    });
  });

  it("offers no button to a client without a Seat", () => {
    expect(podiumRematch(GUESTS, null, []).mine).toBeNull();
    expect(podiumRematch(GUESTS, "gone", ["p1"]).mine).toBeNull();
  });

  it("gives every Guest a chip, agreed or waiting, and a Bot none", () => {
    const withBot = [...GUESTS, player("bot", 3, true)];
    expect(podiumRematch(withBot, "p1", ["p3"]).votes).toEqual([
      { player: withBot[0], agreed: false },
      { player: withBot[1], agreed: false },
      { player: withBot[2], agreed: true },
    ]);
  });

  it("reads a push without votes as every Guest waiting", () => {
    expect(podiumRematch(GUESTS, "p1", undefined).votes.map((vote) => vote.agreed)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("drops a vote for a Player the view does not carry", () => {
    expect(podiumRematch(GUESTS, "p1", ["gone"]).votes.map((vote) => vote.agreed)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("the Podium's rematch markup", () => {
  it("draws the rematch button for a seated Player and a chip per Guest", () => {
    inLanguage("en");
    roomStore.setState({ me: "p1" });
    receivePush(pushOf(gameOverView([...GUESTS, player("bot", 3, true)]), []), 0);

    const html = renderPodium();
    expect(buttonText(html)).toBe("Rematch");
    expect(chipIds(html)).toEqual(["p1", "p2", "p3"]);
  });

  it("reads the chips' agreed and waiting state from the votes", () => {
    inLanguage("en");
    roomStore.setState({ me: "p1" });
    receivePush(pushOf(gameOverView(), ["p2"]), 0);

    const html = renderPodium();
    expect(html).toContain('data-player="p2" data-agreed="true"');
    expect(html).not.toContain('data-player="p1" data-agreed="true"');
    expect(html).toContain("Agreed");
    expect(html).toContain("Waiting");
  });

  it("toggles to the withdraw button when this Player's vote arrives at the open Podium", () => {
    inLanguage("en");
    roomStore.setState({ me: "p1" });
    receivePush(pushOf(gameOverView(), []), 0);
    expect(buttonText(renderPodium())).toBe("Rematch");

    // A vote arrives in a push of its own, with no events and the same view.
    receivePush(pushOf(gameOverView(), ["p1"]), 1_000);
    expect(buttonText(renderPodium())).toBe("Withdraw rematch");
  });

  it("disables the button while an intent is in flight", () => {
    inLanguage("en");
    roomStore.setState({ me: "p1" });
    receivePush(pushOf(gameOverView(), []), 0);
    expect(buttonTag(renderPodium())).not.toMatch(/\sdisabled=""/);

    markIntentSent();
    expect(buttonTag(renderPodium())).toMatch(/\sdisabled=""/);
  });

  it("draws no button for a client that holds no Seat", () => {
    inLanguage("en");
    roomStore.setState({ me: null });
    receivePush(pushOf(gameOverView(), []), 0);

    const html = renderPodium();
    expect(html).not.toContain('data-testid="rematch-button"');
    expect(chipIds(html)).toEqual(["p1", "p2", "p3"]);
  });

  it("draws every chip as waiting when the push carries no votes", () => {
    inLanguage("en");
    roomStore.setState({ me: "p1" });
    receivePush(pushOf(gameOverView(), undefined), 0);

    const html = renderPodium();
    expect(html).not.toContain('data-agreed="true"');
    expect(html).toContain("Waiting");
    expect(buttonText(html)).toBe("Rematch");
  });
});
