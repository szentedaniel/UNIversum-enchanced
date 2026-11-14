/**
 * The quick-chat bubbles (#176, #230): the latest line or emote per Seat, shown
 * by that Player's card for `BUBBLE_MS`. The server keeps no history, so the
 * store is memory only — a reload, a reconnect or leaving the Room shows none —
 * and it never goes through the Playback core (ADR-0004): its length is a UI
 * timing, and time is handed to every action so a test can fake the clock.
 */
import type { ChatId } from "@universum/protocol/messages";
import { createStore } from "zustand/vanilla";

/** How long a bubble stays by the card: a UI timing, not a Playback length (ADR-0004). */
export const BUBBLE_MS = 4_000;

/** One Seat's bubble: the catalogue id and when it appeared. */
export type ChatBubble = { id: ChatId; shownAt: number };

export type ChatState = {
  /** The latest chat per Seat, keyed by `PlayerSummary.seat`. */
  bubbles: ReadonlyMap<number, ChatBubble>;
  /** Shows `id` by `seat` from `now`, replacing that Seat's earlier bubble. */
  show(seat: number, id: ChatId, now: number): void;
  /** The Seat's bubble at `now`; `null` once `BUBBLE_MS` has passed. */
  bubbleAt(seat: number, now: number): ChatBubble | null;
  /** Drops every bubble whose time is up at `now`; the store's own wake-up calls it. */
  expire(now: number): void;
  /** Forgets every bubble: leaving the Room. */
  reset(): void;
};

const NO_BUBBLES: ReadonlyMap<number, ChatBubble> = new Map();

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

/** Wakes at the soonest expiry after `now`, so the screen re-renders without a bubble. */
function armExpiry(now: number): void {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  let due: number | null = null;
  for (const bubble of chatStore.getState().bubbles.values()) {
    const at = bubble.shownAt + BUBBLE_MS;
    if (due === null || at < due) due = at;
  }
  if (due !== null) {
    expiryTimer = setTimeout(() => chatStore.getState().expire(Date.now()), Math.max(due - now, 0));
  }
}

export const chatStore = createStore<ChatState>()((set, get) => ({
  bubbles: NO_BUBBLES,
  show: (seat, id, now) => {
    set({ bubbles: new Map(get().bubbles).set(seat, { id, shownAt: now }) });
    armExpiry(now);
  },
  bubbleAt: (seat, now) => {
    const bubble = get().bubbles.get(seat) ?? null;
    return bubble !== null && now - bubble.shownAt < BUBBLE_MS ? bubble : null;
  },
  expire: (now) => {
    const live = new Map<number, ChatBubble>();
    for (const [seat, bubble] of get().bubbles) {
      if (now - bubble.shownAt < BUBBLE_MS) live.set(seat, bubble);
    }
    if (live.size !== get().bubbles.size) set({ bubbles: live });
    armExpiry(now);
  },
  reset: () => {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    set({ bubbles: NO_BUBBLES });
  },
}));
