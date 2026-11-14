/**
 * The quick-chat mute setting (#176, #232): one switch that hides the tray and
 * every bubble on this device, remembered in `localStorage` so it survives the
 * reload a language switch (or a reopened tab) causes. The key is its own, not
 * the sound's: muting sound must not mute chat, nor the reverse.
 */
import { createStore } from "zustand/vanilla";
import { chatStore } from "#stores/chat-store.ts";

export const CHAT_MUTED_KEY = "universum.chatMuted";

function storedMuted(): boolean {
  try {
    return localStorage.getItem(CHAT_MUTED_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, a blocked origin): chat shows.
    return false;
  }
}

function remember(muted: boolean): void {
  try {
    localStorage.setItem(CHAT_MUTED_KEY, muted ? "1" : "0");
  } catch {
    // The choice still applies to this page; it just won't be remembered.
  }
}

export type ChatMuteState = {
  muted: boolean;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
};

export const chatMuteStore = createStore<ChatMuteState>()((set, get) => ({
  muted: storedMuted(),
  setMuted: (muted) => {
    remember(muted);
    // Mute hides chat and forgets it: a bubble that arrived while muted must
    // not pop up the moment the Guest unmutes.
    chatStore.getState().reset();
    set({ muted });
  },
  toggleMuted: () => get().setMuted(!get().muted),
}));
