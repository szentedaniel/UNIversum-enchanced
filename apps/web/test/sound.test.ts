import { afterEach, describe, expect, it, vi } from "vitest";

/** Just the parts of HTMLAudioElement the cue pool uses. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  volume = 1;
  muted = false;
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

/** Loads the module fresh, as a new page would: the stored mute choice is read on import. */
async function loadAudio() {
  vi.resetModules();
  return import("#audio.ts");
}

const press = (type: string) => {
  for (const listener of listeners.get(type) ?? []) listener();
};

/**
 * Lets an unlock's awaited silent play finish, and the cue it holds back, so
 * the assertions read the final counts. Two microtask rounds: the unlock's
 * `await play()`, then its queued cue.
 */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances = [];
  storage.clear();
  listeners.clear();
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
}

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

  it("is silent and stays silent after a reload once muted", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setMuted(true);
    expect(storage.get("universum.soundMuted")).toBe("1");
    first.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);

    const second = await loadAudio();
    expect(second.soundStore.getState().muted).toBe(true);
    second.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("plays again after unmuting, and remembers that too", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setMuted(true);
    first.playCue("dice");
    expect(FakeAudio.instances).toHaveLength(0);
    first.soundStore.getState().setMuted(false);
    first.playCue("dice");

    expect(storage.get("universum.soundMuted")).toBe("0");
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

    expect(FakeAudio.instances.map((sound) => sound.plays)).toEqual([2, 2, 2]);
    expect(FakeAudio.instances.map((sound) => sound.pauses)).toEqual([1, 1, 1]);
    expect(FakeAudio.instances.every((sound) => sound.volume === 1)).toBe(true);
  });

  it("creates and unlocks every element inside the first gesture, before any cue", async () => {
    stubBrowser();
    const { installAudioUnlock, playCue } = await loadAudio();
    installAudioUnlock();
    press("pointerdown");
    await settle();
    expect(FakeAudio.instances.map((sound) => sound.plays)).toEqual([1, 1, 1]);
    expect(FakeAudio.instances.map((sound) => sound.pauses)).toEqual([1, 1, 1]);

    playCue("dice");
    await settle();

    const [sound] = FakeAudio.instances;
    expect(FakeAudio.instances).toHaveLength(3);
    expect(sound?.plays).toBe(2);
    expect(sound?.volume).toBe(1);
  });

  it("unlocks without a sound when muted", async () => {
    stubBrowser();
    const { installAudioUnlock, playCue, soundStore } = await loadAudio();
    for (let play = 0; play < 3; play += 1) playCue("dice");
    soundStore.getState().setMuted(true);

    installAudioUnlock();
    press("pointerdown");
    await settle();

    expect(FakeAudio.instances.map((sound) => sound.plays)).toEqual([2, 2, 2]);
    expect(FakeAudio.instances.every((sound) => sound.volume === 1)).toBe(true);
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
