import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlayerId, PublicView } from "@universum/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintList, HintsToggle } from "#components/GameMenu.tsx";
import { openDecision } from "#decision/decision.ts";
import { HINTS, nextHint, type HintId, type HintMessageKey } from "#hints/hints.ts";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import type { Frame } from "#playback/playback.ts";
import { playbackOfPush } from "#playback/playback.ts";
import { hintStore } from "#stores/hint-store.ts";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };
import { fieldOf, viewOf } from "./playback-fixtures.ts";

// The hint table (spec #180): which concept a first-time Guest meets, from the
// Decision module's answer and the frame's view. No Playback timers, no wall
// clock. The menu's hint list and switch read the same table and the hint
// store, so the menu tests drive `hintStore` directly.

// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written. The menu's two hint
// parts read the store through `useStore`; this hands them the state the store
// holds, as a mounted client reads it (same seam as chat-mute.test.ts).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => inLanguage("en"));
afterEach(() => inLanguage(baseLocale));

const RECEIVED_AT = 1_000;

/** `view` in a frame, with the gate open or just before it opens. */
function frameOf(view: PublicView, gate: "open" | "shut" = "open"): Frame {
  const playback = playbackOfPush({
    view,
    events: [],
    reveals: [],
    seq: 1,
    clockOffset: 0,
    receivedAt: RECEIVED_AT,
  });
  return playback.frameAt(gate === "open" ? playback.opensAt : playback.opensAt - 1);
}

/** The hint this client would show in `view`, as the screens compute it. */
function hintIn(
  view: PublicView,
  {
    me = view.currentPlayer,
    seen = new Set<HintId>(),
    enabled = true,
    inFlight = false,
    gate = "open",
  }: {
    me?: PlayerId | null;
    seen?: ReadonlySet<HintId>;
    enabled?: boolean;
    inFlight?: boolean;
    gate?: "open" | "shut";
  } = {},
) {
  return nextHint({
    decision: openDecision(frameOf(view, gate), me, inFlight),
    view,
    seen,
    enabled,
  });
}

const offerView = (): PublicView =>
  viewOf(undefined, {
    phase: { kind: "offer", field: 13, levels: [{ level: 1, price: 100_000 }] },
  });

const quarantineView = (): PublicView =>
  viewOf(undefined, {
    phase: {
      kind: "quarantineChoice",
      canBuyPcrTest: true,
      canUsePcrTest: false,
      pcrTestPrice: 200_000,
    },
  });

const saleView = (): PublicView =>
  viewOf(undefined, {
    phase: { kind: "selling", shortfall: 50_000, resume: { kind: "tax", amount: 150_000 } },
    fields: [fieldOf({ owner: "p1", sale: 100_000 }), fieldOf()],
    autoSell: [0],
  });

const doublerView = (): PublicView =>
  viewOf(undefined, { phase: { kind: "placingDoubler", fields: [1, 2] } });

const erasmusView = (): PublicView =>
  viewOf(undefined, { phase: { kind: "choosingErasmus", fields: [24] } });

const gameOverView = (): PublicView =>
  viewOf(undefined, { phase: { kind: "gameOver", winner: "p2", reason: "timeUp" } });

const CONCEPTS: readonly {
  name: string;
  id: HintId;
  messageKey: HintMessageKey;
  view: () => PublicView;
}[] = [
  { name: "my Offer", id: "offer", messageKey: "hint_offer", view: offerView },
  {
    name: "my Quarantine choice",
    id: "quarantine",
    messageKey: "hint_quarantine",
    view: quarantineView,
  },
  { name: "my Doubler pick", id: "doubler", messageKey: "hint_doubler", view: doublerView },
  { name: "my Erasmus pick", id: "erasmus", messageKey: "hint_erasmus", view: erasmusView },
  { name: "my Sale", id: "sale", messageKey: "hint_sale", view: saleView },
  { name: "my first Roll", id: "gameEnd", messageKey: "hint_game_end", view: () => viewOf() },
];

describe("the hint table", () => {
  it("keeps the stored ids stable, in table order", () => {
    expect(HINTS.map((row) => row.id)).toEqual([
      "offer",
      "quarantine",
      "doubler",
      "erasmus",
      "sale",
      "gameEnd",
    ]);
  });

  it("names a message that exists in Hungarian, English and German", () => {
    for (const row of HINTS) {
      for (const messages of [hu, en, de]) {
        expect(messages[row.messageKey]).toBeTypeOf("string");
      }
    }
  });
});

describe("nextHint", () => {
  it.each(CONCEPTS)("opens the $id hint at $name", ({ view, id, messageKey }) => {
    expect(hintIn(view())).toMatchObject({ id, messageKey });
  });

  it.each(CONCEPTS)("waits for the Playback gate at $name", ({ view, id }) => {
    expect(hintIn(view(), { gate: "shut" })).toBeNull();
    expect(hintIn(view())?.id).toBe(id);
  });

  it("shows no hint for another Player's Decision", () => {
    for (const view of [
      viewOf(),
      offerView(),
      quarantineView(),
      doublerView(),
      erasmusView(),
      saleView(),
    ]) {
      expect(hintIn(view, { me: "p2" })).toBeNull();
    }
  });

  it("shows no hint to a spectator", () => {
    for (const view of [offerView(), doublerView(), saleView()]) {
      expect(hintIn(view, { me: null })).toBeNull();
    }
  });

  it("never opens the game-end hint at the Podium", () => {
    expect(hintIn(gameOverView())).toBeNull();
  });

  it("does not repeat a hint that was dismissed", () => {
    const seen = new Set<HintId>(["offer"]);

    expect(hintIn(offerView(), { seen })).toBeNull();
    expect(hintIn(saleView(), { seen })?.id).toBe("sale");
  });

  it.each(CONCEPTS)("shows no hint while hints are off: $name", ({ view }) => {
    expect(hintIn(view(), { enabled: false })).toBeNull();
  });

  it("brings a dismissed hint back at its trigger after the menu reset", () => {
    hintStore.setState({ seen: new Set<HintId>(), enabled: true });
    hintStore.getState().dismiss("offer");
    expect(hintIn(offerView(), { seen: hintStore.getState().seen })).toBeNull();

    hintStore.getState().reset();
    expect(hintIn(offerView(), { seen: hintStore.getState().seen })?.id).toBe("offer");
  });

  it("keeps a pick's hint while its commit is in flight", () => {
    expect(hintIn(doublerView(), { inFlight: true })?.id).toBe("doubler");
  });
});

describe("the menu's hint list", () => {
  it("shows every hint's text in the current language, whether seen or not", () => {
    inLanguage("de");
    // The list is a re-read list: the switch and the seen set do not filter it.
    hintStore.setState({ seen: new Set<HintId>(["offer", "sale"]), enabled: false });

    const list = renderToStaticMarkup(createElement(HintList));
    const rows = [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);

    expect(rows).toEqual(HINTS.map((row) => de[row.messageKey]));
    expect(list).toContain('data-testid="hint-list"');
    expect(list).toContain(de.hints_list_title);
    expect(list).toContain('data-testid="hints-reset"');
    expect(list).toContain(de.hints_reset);
  });

  it("labels the switch with the current setting", () => {
    hintStore.setState({ enabled: true });
    const on = renderToStaticMarkup(createElement(HintsToggle));
    expect(on).toContain('data-testid="hints-toggle"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain(en.hints_on);

    hintStore.setState({ enabled: false });
    const off = renderToStaticMarkup(createElement(HintsToggle));
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain(en.hints_off);
  });
});
