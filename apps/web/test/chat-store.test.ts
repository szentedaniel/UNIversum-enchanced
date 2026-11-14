import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUBBLE_MS, chatStore } from "#stores/chat-store.ts";

// The quick-chat bubbles (#230): the latest line or emote per Seat, shown by
// that Player's card for BUBBLE_MS. Time is handed in, so a test advances a
// fake clock and nothing waits on a real timer.

const T0 = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  chatStore.getState().reset();
});

afterEach(() => {
  chatStore.getState().reset();
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
