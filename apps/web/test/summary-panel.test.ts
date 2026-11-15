import type { GameSummaryView, PlayerView, PublicView } from "@universum/rules";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Podium } from "#components/Podium.tsx";
import { Summary } from "#components/Summary.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { playerLook } from "#players.ts";
import { viewOf } from "./playback-fixtures.ts";

// The result screen's Summary (spec #177, ticket #238): the four figures the
// engine counted and the Wealth chart, drawn from the final view's Summary.
// The figures are the engine's (ADR-0001, ADR-0005); this screen only looks
// Players up and formats them.

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
});

const NAMES = [
  { adjective: "happy", noun: "tiger" },
  { adjective: "calm", noun: "wolf" },
  { adjective: "busy", noun: "beaver" },
  { adjective: "brave", noun: "bear" },
] as const;

const PLAYERS: PlayerView[] = [0, 1, 2, 3].map((seat) => ({
  id: `p${seat + 1}`,
  seat,
  name: NAMES[seat] ?? NAMES[0],
  cash: 0,
  wealth: 0,
  position: 0,
  bankrupt: seat === 2,
  quarantineRounds: null,
  hasPcrTest: false,
  bot: false,
}));

const SUMMARY: GameSummaryView = {
  biggestRent: { payer: "p2", owner: "p1", field: 5, amount: 1_200_000 },
  fieldsBought: { p1: 2, p2: 4, p3: 0, p4: 1 },
  monopolies: [
    { player: "p2", group: 2 },
    { player: "p2", group: 1 },
  ],
  bankruptcies: ["p3"],
  series: [
    { minute: 0, wealth: { p1: 2_500_000, p2: 2_500_000, p3: 2_500_000, p4: 2_500_000 } },
    { minute: 4, wealth: { p1: 2_200_000, p2: 2_900_000, p3: 1_500_000, p4: 2_300_000 } },
    { minute: 9, wealth: { p1: 2_000_000, p2: 3_000_000, p3: 0, p4: 4_100_000 } },
  ],
};

const EMPTY: GameSummaryView = {
  biggestRent: null,
  fieldsBought: {},
  monopolies: [],
  bankruptcies: [],
  series: [],
};

/** A game-over view with the given Summary, as the server's final publicView sends it. */
function gameOver(summary: GameSummaryView | null): PublicView {
  return viewOf(undefined, {
    turn: 9,
    phase: { kind: "gameOver", winner: "p4", reason: "timeUp" },
    players: PLAYERS,
    standings: PLAYERS.map((player) => ({ player: player.id, wealth: player.wealth })),
    summary,
  });
}

const renderSummary = (view: PublicView) =>
  renderToStaticMarkup(createElement(Summary, { view, onBack: () => {} }));

function renderPodium(view: PublicView) {
  if (view.phase.kind !== "gameOver") throw new Error("the test's view ends the game");
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/game/123456" },
      createElement(Podium, { view, phase: view.phase, me: null, busy: false }),
    ),
  );
}

/** How many elements carry the given test id. */
const countOf = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;

/** Intl separates groups and units with no-break spaces; compare with plain ones. */
const plain = (text: string) => text.replaceAll(/[\u00A0\u202F]/g, " ");

describe("the Podium's way into the Summary", () => {
  it("offers the Summary button when the final view carries one", () => {
    inLanguage("en");
    const html = renderPodium(gameOver(SUMMARY));

    expect(html).toContain('data-testid="summary-open"');
    expect(html).toContain("Summary");
    // The Podium itself stays: its own selectors must not move.
    expect(html).toContain('data-testid="podium-title"');
    expect(html).toContain('data-testid="podium-places"');
  });

  it("shows nothing but the Podium when the view carries no Summary", () => {
    inLanguage("en");
    const html = renderPodium(gameOver(null));

    expect(html).toContain('data-testid="podium-title"');
    expect(html).not.toContain('data-testid="summary-open"');
    expect(html).not.toContain('data-testid="summary"');
  });
});

describe("the Summary", () => {
  it("draws the four figures in the ticket's order", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(html).toContain('data-testid="summary"');
    expect(html).toContain("The game in numbers");
    expect([...html.matchAll(/data-figure="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "rent",
      "buyer",
      "monopolies",
      "bankruptcies",
    ]);
  });

  it("names the biggest Rent's payer, owner, amount and Field", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(plain(html)).toContain("Calm Wolf paid Ft 1,200,000 Rent to Happy Tiger on Zurich");
  });

  it("names the top buyer and their count", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(html).toContain("Most Fields bought");
    expect(html).toContain("Calm Wolf: 4");
  });

  it("names each Monopoly's Player and its Group's Universities, in formed order", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(html).toContain("Calm Wolf: Zurich, Paris, Edinburgh");
    expect(html).toContain("Calm Wolf: Veszprém, Budapest, Debrecen");
  });

  it("lists the Bankrupt Players", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(html).toContain("Busy Beaver");
    expect(html).toContain("Bankruptcies");
  });

  it("says so when a figure has nothing to report", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(EMPTY));

    expect(html).toContain("No Rent was paid.");
    expect(html).toContain("Nobody bought a Field.");
    expect(html).toContain("No Monopoly was formed.");
    expect(html).toContain("Nobody went Bankrupt.");
  });

  it("draws a line and an end marker per Player, in the Player's own colour", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(countOf(html, "chart-line")).toBe(PLAYERS.length);
    expect(countOf(html, "chart-marker")).toBe(PLAYERS.length);
    for (const player of PLAYERS) {
      expect(html).toContain(`stroke="${playerLook(player.seat).color}"`);
    }
  });

  it("gives the chart an accessible name and a text list of each Player's start and end Wealth", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(SUMMARY));

    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="Wealth of every Player over the game&#x27;s Minutes, with each line&#x27;s end marked"',
    );
    expect(countOf(html, "chart-player")).toBe(PLAYERS.length);
    expect(plain(html)).toContain("Happy Tiger: Ft 2,500,000 → Ft 2,000,000");
    expect(plain(html)).toContain("Brave Bear: Ft 2,500,000 → Ft 4,100,000");
  });

  it("draws no chart frame and no line when the game has no Wealth samples", () => {
    inLanguage("en");
    const html = renderSummary(gameOver(EMPTY));

    expect(countOf(html, "chart-line")).toBe(0);
    expect(html).not.toContain('data-testid="wealth-chart-svg"');
    expect(html).toContain("This game has no Wealth samples to chart.");
  });

  it("renders nothing when the view carries no Summary", () => {
    expect(renderSummary(gameOver(null))).toBe("");
  });
});

describe("the Summary's language", () => {
  it("speaks Hungarian and German", () => {
    inLanguage("hu");
    const hu = renderSummary(gameOver(SUMMARY));
    expect(hu).toContain("A játék számokban");
    expect(hu).toContain("Legnagyobb tandíj");

    inLanguage("de");
    const de = renderSummary(gameOver(SUMMARY));
    expect(de).toContain("Das Spiel in Zahlen");
    expect(de).toContain("Höchste Miete");
  });
});
