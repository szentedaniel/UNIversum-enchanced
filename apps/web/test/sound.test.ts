import { afterEach, describe, expect, it, vi } from "vitest";
import musicFile from "#assets/sounds/music.mp3";
import { CUES } from "#sound/cues.ts";
import { MUSIC_ON_KEY, SOUND_MUTED_KEY } from "#stores/sound-store.ts";

/** Just the parts of HTMLAudioElement the sound module uses. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  volume = 1;
  muted = false;
  loop = false;
  plays = 0;
  pauses = 0;
  src: string;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.plays += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.pauses += 1;
  }
}

const storage = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
/** What `document.hidden` reports; a visibility test flips it and presses the listener. */
let hidden = false;

/** Loads the module fresh, as a new page would: the stored mute choice is read on import. */
async function loadAudio() {
  vi.resetModules();
  return import("#audio.ts");
}

const press = (type: string) => {
  for (const listener of listeners.get(type) ?? []) listener();
};

/** The music element: the one playing the track, not a cue. */
const musicSound = () => FakeAudio.instances.find((sound) => sound.src === musicFile);

/**
 * Lets an unlock's awaited silent play finish, and the music or cue it holds
 * back, so the assertions read the final counts: a few microtask rounds drain
 * the unlock's `await play()`, its `pause()` and the play queued behind it.
 */
const settle = () => {
  let rounds = Promise.resolve();
  for (let round = 0; round < 10; round += 1) rounds = rounds.then(() => undefined);
  return rounds;
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances = [];
  storage.clear();
  listeners.clear();
  hidden = false;
});

function stubBrowser() {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: () => void) =>
      listeners.get(type)?.delete(listener),
  });
  // The music pauses while the tab is hidden: the module adds one listener on import.
  vi.stubGlobal("document", {
    get hidden() {
      return hidden;
    },
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: () => void) =>
      listeners.get(type)?.delete(listener),
  });
}

/** Storage that refuses every read and write, as a private window does. */
function stubBlockedStorage() {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("storage is blocked");
    },
    setItem: () => {
      throw new Error("storage is blocked");
    },
  });
}

describe("the sound settings", () => {
  it("keeps an existing effects mute from the legacy key, with the music off", async () => {
    stubBrowser();
    storage.set(SOUND_MUTED_KEY, "1");

    const { soundStore } = await loadAudio();

    expect(soundStore.getState().effectsMuted).toBe(true);
    expect(soundStore.getState().musicOn).toBe(false);
  });

  it("turns the effects and the music independently, each remembered under its own key", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().toggleEffectsMuted();
    expect(storage.get(SOUND_MUTED_KEY)).toBe("1");
    expect(storage.get(MUSIC_ON_KEY)).toBeUndefined();

    first.soundStore.getState().toggleMusicOn();
    expect(storage.get(MUSIC_ON_KEY)).toBe("1");

    const second = await loadAudio();
    expect(second.soundStore.getState().effectsMuted).toBe(true);
    expect(second.soundStore.getState().musicOn).toBe(true);

    second.soundStore.getState().toggleMusicOn();
    expect(storage.get(MUSIC_ON_KEY)).toBe("0");
    expect(second.soundStore.getState().effectsMuted).toBe(true);
  });

  it("still applies on this page when storage is unavailable, with the music off", async () => {
    stubBrowser();
    stubBlockedStorage();
    const { soundStore } = await loadAudio();
    expect(soundStore.getState().effectsMuted).toBe(false);
    expect(soundStore.getState().musicOn).toBe(false);

    expect(() => soundStore.getState().toggleMusicOn()).not.toThrow();
    expect(soundStore.getState().musicOn).toBe(true);
    expect(soundStore.getState().effectsMuted).toBe(false);
  });
});

describe("the sound cues", () => {
  it("starts two cues in quick succession, each through its own element, from the start", async () => {
    stubBrowser();
    const { playCue } = await loadAudio();

    playCue("dice");
    playCue("dice");

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances.map((sound) => sound.plays)).toEqual([1, 1]);
    expect(FakeAudio.instances.every((sound) => sound.currentTime === 0)).toBe(true);
  });

  it("keeps a few elements per cue and reuses them round-robin", async () => {
    stubBrowser();
    const { playCue } = await loadAudio();

    for (let play = 0; play < 4; play += 1) playCue("dice");

    expect(FakeAudio.instances.map((sound) => sound.plays)).toEqual([2, 1, 1]);
  });

  it("is silent and stays silent after a reload once the effects are off", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setEffectsMuted(true);
    expect(storage.get(SOUND_MUTED_KEY)).toBe("1");
    first.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);

    const second = await loadAudio();
    expect(second.soundStore.getState().effectsMuted).toBe(true);
    second.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("plays again after unmuting the effects, and remembers that too", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setEffectsMuted(true);
    first.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);
    first.soundStore.getState().setEffectsMuted(false);
    first.playCue("dice");

    expect(storage.get(SOUND_MUTED_KEY)).toBe("0");
    expect(FakeAudio.instances[0]?.plays).toBe(1);
  });

  it("unlocks every pooled element on the first pointer press, once", async () => {
    stubBrowser();
    const { installAudioUnlock, playCue } = await loadAudio();
    for (let play = 0; play < 3; play += 1) playCue("dice");

    installAudioUnlock();
    press("pointerdown");
    press("pointerdown");
    await settle();

    for (const [name, file] of Object.entries(CUES)) {
      const elements = FakeAudio.instances.filter((sound) => sound.src === file);
      // The dice already played its three cues; every other cue only unlocked.
      expect(elements.map((sound) => sound.plays)).toEqual(name === "dice" ? [2, 2, 2] : [1, 1, 1]);
      expect(elements.map((sound) => sound.pauses)).toEqual([1, 1, 1]);
      expect(elements.every((sound) => sound.volume === 1)).toBe(true);
    }
  });

  it("creates and unlocks every element inside the first gesture, before any cue", async () => {
    stubBrowser();
    const { installAudioUnlock, playCue } = await loadAudio();
    installAudioUnlock();
    press("pointerdown");
    await settle();
    expect(FakeAudio.instances).toHaveLength(3 * Object.keys(CUES).length + 1);
    expect(FakeAudio.instances.every((sound) => sound.plays === 1)).toBe(true);
    expect(FakeAudio.instances.every((sound) => sound.pauses === 1)).toBe(true);

    playCue("dice");
    await settle();

    const sound = FakeAudio.instances.find((element) => element.src === CUES.dice);
    expect(FakeAudio.instances).toHaveLength(3 * Object.keys(CUES).length + 1);
    expect(sound?.plays).toBe(2);
    expect(sound?.volume).toBe(1);
  });

  it("unlocks without a sound when the effects are off", async () => {
    stubBrowser();
    const { installAudioUnlock, playCue, soundStore } = await loadAudio();
    for (let play = 0; play < 3; play += 1) playCue("dice");
    soundStore.getState().setEffectsMuted(true);

    installAudioUnlock();
    press("pointerdown");
    await settle();

    for (const [name, file] of Object.entries(CUES)) {
      const elements = FakeAudio.instances.filter((sound) => sound.src === file);
      expect(elements.map((sound) => sound.plays)).toEqual(name === "dice" ? [2, 2, 2] : [1, 1, 1]);
      expect(elements.every((sound) => sound.volume === 1)).toBe(true);
    }
  });

  it("stays muted and still counted under browser automation", async () => {
    stubBrowser();
    vi.stubGlobal("navigator", { webdriver: true });
    const { playCue } = await loadAudio();

    playCue("dice");

    expect(FakeAudio.instances[0]?.muted).toBe(true);
    expect(FakeAudio.instances[0]?.plays).toBe(1);
  });
});

describe("the background music", () => {
  it("does not start before the first gesture, even when it is on", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    const { soundStore } = await loadAudio();

    expect(soundStore.getState().musicOn).toBe(true);
    expect(musicSound()).toBeUndefined();
  });

  it("starts looping from the stored choice on the first gesture, after the silent unlock", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    const { installAudioUnlock } = await loadAudio();

    installAudioUnlock();
    press("pointerdown");
    await settle();

    expect(musicSound()?.loop).toBe(true);
    // The unlock's silent play, then the music itself.
    expect(musicSound()?.plays).toBe(2);
  });

  it("is unlocked but silent when the music is off", async () => {
    stubBrowser();
    const { installAudioUnlock } = await loadAudio();

    installAudioUnlock();
    press("pointerdown");
    await settle();

    expect(musicSound()?.plays).toBe(1);
    expect(musicSound()?.pauses).toBe(1);
  });

  it("pauses when turned off and resumes when turned on again", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    const { installAudioUnlock, soundStore } = await loadAudio();
    installAudioUnlock();
    press("pointerdown");
    await settle();
    const element = musicSound();

    soundStore.getState().setMusicOn(false);
    expect(element?.pauses).toBe(2);

    soundStore.getState().setMusicOn(true);
    expect(element?.plays).toBe(3);
  });

  it("keeps playing when the effects are muted", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    const { installAudioUnlock, soundStore } = await loadAudio();
    installAudioUnlock();
    press("pointerdown");
    await settle();
    const element = musicSound();

    soundStore.getState().setEffectsMuted(true);

    expect(element?.pauses).toBe(1);
    expect(element?.plays).toBe(2);
  });

  it("pauses while the tab is hidden and resumes when it shows again", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    const { installAudioUnlock } = await loadAudio();
    installAudioUnlock();
    press("pointerdown");
    await settle();
    const element = musicSound();

    hidden = true;
    press("visibilitychange");
    expect(element?.pauses).toBe(2);

    hidden = false;
    press("visibilitychange");
    expect(element?.plays).toBe(3);
  });

  it("stays muted under automation but still calls play()", async () => {
    stubBrowser();
    storage.set(MUSIC_ON_KEY, "1");
    vi.stubGlobal("navigator", { webdriver: true });
    const { installAudioUnlock } = await loadAudio();

    installAudioUnlock();
    press("pointerdown");
    await settle();

    expect(musicSound()?.muted).toBe(true);
    expect(musicSound()?.plays).toBe(2);
  });
});
