/**
 * The sound setting: one mute toggle for the game, remembered in `localStorage`
 * so it survives the reload a language switch (or a reopened tab) causes.
 */
import { createStore } from "zustand/vanilla";

export const SOUND_MUTED_KEY = "universum.soundMuted";

function storedMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_MUTED_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, a blocked origin): sound stays on.
    return false;
  }
}

function remember(muted: boolean): void {
  try {
    localStorage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0");
  } catch {
    // The choice still applies to this page; it just won't be remembered.
  }
}

export type SoundState = {
  muted: boolean;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
};

export const soundStore = createStore<SoundState>()((set, get) => ({
  muted: storedMuted(),
  setMuted: (muted) => {
    remember(muted);
    set({ muted });
  },
  toggleMuted: () => get().setMuted(!get().muted),
}));
