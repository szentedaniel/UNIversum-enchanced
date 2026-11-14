import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale, overwriteGetLocale } from "#paraglide/runtime.js";
import { PlayerCard, type PlayerSummary } from "#components/PlayerCard.tsx";
import { BUBBLE_MS, chatStore } from "#stores/chat-store.ts";

// The quick-chat bubbles (#230): the latest line or emote per Seat, shown by
// that Player's card for BUBBLE_MS. Time is handed in, so a test advances a
// fake clock and nothing waits on a real timer.

// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written. The card reads the
// store through `useStore`; this hands it the state the store holds, as a
// mounted client reads it. No DOM environment is installed (same seam as
// rematch-return.test.ts).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

const T0 = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  chatStore.getState().reset();
});

afterEach(() => {
  chatStore.getState().reset();
  overwriteGetLocale(() => baseLocale);
  vi.useRealTimers();
});

describe("the chat store", () => {
  it("shows a Seat's chat while it is younger than BUBBLE_MS", () => {
    chatStore.getState().show(0, "good_luck", T0);

    expect(chatStore.getState().bubbleAt(0, T0)).toEqual({ id: "good_luck", shownAt: T0 });
    expect(chatStore.getState().bubbleAt(0, T0 + BUBBLE_MS - 1)).toEqual({
      id: "good_luck",
      shownAt: T0,
    });
  });

  it("expires exactly BUBBLE_MS later", () => {
    chatStore.getState().show(0, "good_luck", T0);

    expect(chatStore.getState().bubbleAt(0, T0 + BUBBLE_MS)).toBeNull();
  });

  it("drops the bubble on its own and tells the screen, so it disappears without a read", () => {
    const sizes: number[] = [];
    const unsubscribe = chatStore.subscribe((state) => sizes.push(state.bubbles.size));
    chatStore.getState().show(0, "good_luck", T0);

    vi.advanceTimersByTime(BUBBLE_MS);

    expect(chatStore.getState().bubbles.size).toBe(0);
    expect(sizes).toEqual([1, 0]);
    unsubscribe();
  });

  it("expires through the time it is handed", () => {
    chatStore.getState().show(0, "good_luck", T0);

    chatStore.getState().expire(T0 + BUBBLE_MS - 1);
    expect(chatStore.getState().bubbles.size).toBe(1);

    chatStore.getState().expire(T0 + BUBBLE_MS);
    expect(chatStore.getState().bubbles.size).toBe(0);
  });

  it("replaces a Seat's bubble with a newer chat, keeping one per Seat", () => {
    chatStore.getState().show(0, "good_luck", T0);
    vi.advanceTimersByTime(1_000);
    chatStore.getState().show(0, "cheer", T0 + 1_000);

    expect(chatStore.getState().bubbles.size).toBe(1);
    expect(chatStore.getState().bubbleAt(0, T0 + 1_000)).toEqual({
      id: "cheer",
      shownAt: T0 + 1_000,
    });
  });

  it("keeps another Seat's bubble when one expires", () => {
    chatStore.getState().show(0, "good_luck", T0);
    vi.advanceTimersByTime(1_000);
    chatStore.getState().show(1, "thinking", T0 + 1_000);

    vi.advanceTimersByTime(BUBBLE_MS - 1_000);
    expect(chatStore.getState().bubbleAt(0, Date.now())).toBeNull();
    expect(chatStore.getState().bubbleAt(1, Date.now())).toEqual({
      id: "thinking",
      shownAt: T0 + 1_000,
    });

    vi.advanceTimersByTime(1_000);
    expect(chatStore.getState().bubbles.size).toBe(0);
  });

  it("forgets every bubble when the Room is left", () => {
    chatStore.getState().show(0, "good_luck", T0);
    chatStore.getState().show(1, "cheer", T0);

    chatStore.getState().reset();

    expect(chatStore.getState().bubbles.size).toBe(0);
    vi.advanceTimersByTime(BUBBLE_MS);
    expect(chatStore.getState().bubbles.size).toBe(0);
  });
});

/** A Seat as the Game screen summarises it (name, money and notes are already formatted). */
const PLAYER: PlayerSummary = {
  seat: 1,
  name: "happy tiger",
  bot: false,
  cash: "10 000 Ft",
  cashShort: "10k",
  fields: 2,
  current: false,
  you: false,
  bankrupt: false,
};

/** The card as the Game screen draws it, reading the bubbles the store holds. */
const renderCard = (player: PlayerSummary = PLAYER) =>
  renderToStaticMarkup(createElement(PlayerCard, { player }));

const BUBBLE = 'data-testid="chat-bubble"';

describe("the bubble by a Player's card", () => {
  it("shows a received line in the viewer's language", () => {
    overwriteGetLocale(() => "en");
    chatStore.getState().show(1, "good_luck", T0);

    const html = renderCard();

    expect(html).toContain(BUBBLE);
    expect(html).toContain("Good luck!");
  });

  it("shows an emote's glyph with its accessible label", () => {
    overwriteGetLocale(() => "en");
    chatStore.getState().show(1, "cheer", T0);

    const html = renderCard();

    expect(html).toContain(BUBBLE);
    expect(html).toContain("🎉");
    expect(html).toContain("Cheer");
  });

  it("leaves another Seat's card without a bubble", () => {
    chatStore.getState().show(1, "good_luck", T0);

    expect(renderCard({ ...PLAYER, seat: 0 })).not.toContain(BUBBLE);
  });

  it("shows a Seat's newer chat in place of the old one", () => {
    overwriteGetLocale(() => "en");
    chatStore.getState().show(1, "good_luck", T0);
    vi.advanceTimersByTime(1_000);
    chatStore.getState().show(1, "thanks", Date.now());

    const html = renderCard();

    expect(html).toContain("Thanks!");
    expect(html).not.toContain("Good luck!");
  });

  it("drops the bubble from the card when its time is up", () => {
    chatStore.getState().show(1, "good_luck", T0);

    vi.advanceTimersByTime(BUBBLE_MS);

    expect(renderCard()).not.toContain(BUBBLE);
  });
});
