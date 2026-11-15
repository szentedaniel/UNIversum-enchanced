/**
 * The sound settings: the cues and the music have a toggle each, remembered in
 * `localStorage` so both survive the reload a language switch (or a reopened
 * tab) causes. The effects keep the old key, so an existing mute still applies;
 * the music has its own key and starts off, because autoplaying it is unwelcome.
 */
import { createStore } from "zustand/vanilla";

/** The effects (cue) toggle, under the key the single mute used before music existed. */
export const SOUND_MUTED_KEY = "universum.soundMuted";
/** The music toggle, off until the Guest turns it on. */
export const MUSIC_ON_KEY = "universum.musicOn";

function storedFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Storage can be unavailable (private mode, a blocked origin): use the default.
    return false;
  }
}

function remember(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // The choice still applies to this page; it just won't be remembered.
  }
}

export type SoundState = {
  /** The cues are silenced, the music is not. */
  effectsMuted: boolean;
  /** The looping music plays once the page has its first gesture. */
  musicOn: boolean;
  setEffectsMuted(muted: boolean): void;
  toggleEffectsMuted(): void;
  setMusicOn(on: boolean): void;
  toggleMusicOn(): void;
};

export const soundStore = createStore<SoundState>()((set, get) => ({
  effectsMuted: storedFlag(SOUND_MUTED_KEY),
  musicOn: storedFlag(MUSIC_ON_KEY),
  setEffectsMuted: (muted) => {
    remember(SOUND_MUTED_KEY, muted);
    set({ effectsMuted: muted });
  },
  toggleEffectsMuted: () => get().setEffectsMuted(!get().effectsMuted),
  setMusicOn: (on) => {
    remember(MUSIC_ON_KEY, on);
    set({ musicOn: on });
  },
  toggleMusicOn: () => get().setMusicOn(!get().musicOn),
}));
