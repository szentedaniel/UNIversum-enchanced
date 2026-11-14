import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HintCard, type HintPlace } from "#components/HintCard.tsx";
import { bottomSlot, openDecision } from "#decision/decision.ts";
import { HINTS, type HintId, type HintRow } from "#hints/hints.ts";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { playbackOfPush } from "#playback/playback.ts";
import { DecisionTray } from "#screens/DecisionTray.tsx";
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };
import { fieldOf, viewOf } from "./playback-fixtures.ts";

// The hint card (spec #180): one short sentence on the concept the Guest meets
// and a dismiss button, inline so it never takes focus or covers a Decision.
// The card also owns which area draws which concept (#255: an Offer and
// Quarantine in the Game's bottom area, a Sale in its tray).

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => inLanguage("en"));
afterEach(() => inLanguage(baseLocale));

const rowOf = (id: HintId): HintRow => {
  const row = HINTS.find((hint) => hint.id === id);
  if (row === undefined) throw new Error(`the hint table has no ${id} row`);
  return row;
};

const render = (hint: HintRow | null, place: HintPlace) =>
  renderToStaticMarkup(createElement(HintCard, { hint, place }));

describe("the hint card", () => {
  it("renders nothing while no hint is open", () => {
    expect(render(null, "bottom")).toBe("");
    expect(render(null, "tray")).toBe("");
  });

  it("draws an Offer and Quarantine in the bottom area, never in the tray", () => {
    for (const id of ["offer", "quarantine"] as const) {
      expect(render(rowOf(id), "bottom")).toContain(`data-hint="${id}"`);
      expect(render(rowOf(id), "tray")).toBe("");
    }
  });

  it("draws a Sale in the tray, never in the bottom area", () => {
    expect(render(rowOf("sale"), "tray")).toContain('data-hint="sale"');
    expect(render(rowOf("sale"), "bottom")).toBe("");
  });

  it("leaves the Doubler, Erasmus and game-end hints to #256", () => {
    for (const id of ["doubler", "erasmus", "gameEnd"] as const) {
      expect(render(rowOf(id), "bottom")).toBe("");
      expect(render(rowOf(id), "tray")).toBe("");
    }
  });

  it("shows the open hint's sentence with a labelled dismiss button", () => {
    // React writes an apostrophe in a text node as `&#x27;`; the sentence is compared as text.
    const html = render(rowOf("offer"), "bottom").replaceAll("&#x27;", "'");

    expect(html).toContain('data-testid="hint"');
    expect(html).toContain(en.hint_offer);
    expect(html).toContain('data-testid="hint-dismiss"');
    expect(html).toContain(`aria-label="${en.hint_dismiss}"`);
  });

  it("reads the sentence in the active language", () => {
    inLanguage("hu");

    const html = render(rowOf("sale"), "tray");

    expect(html).toContain(hu.hint_sale);
    expect(html).toContain(`aria-label="${hu.hint_dismiss}"`);
  });
});

describe("the Sale tray", () => {
  it("draws the Sale hint inside the tray", () => {
    const view = viewOf(undefined, {
      phase: { kind: "selling", shortfall: 50_000, resume: { kind: "tax", amount: 150_000 } },
      fields: [fieldOf({ owner: "p1", sale: 100_000 }), fieldOf()],
      autoSell: [0],
    });
    const playback = playbackOfPush({
      view,
      events: [],
      reveals: [],
      seq: 1,
      clockOffset: 0,
      receivedAt: 0,
    });
    const frame = playback.frameAt(playback.opensAt);
    const slot = bottomSlot(openDecision(frame, "p1", false), frame, {
      selectedField: null,
      inspect: false,
    });
    if (slot.kind !== "sale") throw new Error(`the test opens a Sale, not a ${slot.kind}`);

    const html = renderToStaticMarkup(
      createElement(DecisionTray, { view, slot, clockOffset: 0, seat: 0, hint: rowOf("sale") }),
    );

    expect(html).toContain('data-testid="sale-tray"');
    expect(html).toContain('data-hint="sale"');
    expect(html).toContain(en.hint_dismiss);
  });
});
