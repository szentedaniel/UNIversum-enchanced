import { afterEach, describe, expect, it, vi } from "vitest";

/** Just the parts of HTMLAudioElement the dice sound uses. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  volume = 1;
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

describe("the dice sound", () => {
  it("plays through one HTMLAudioElement, from the start, on every roll", async () => {
    stubBrowser();
    const { playDice } = await loadAudio();

    playDice();
    playDice();

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0]?.plays).toBe(2);
    expect(FakeAudio.instances[0]?.currentTime).toBe(0);
  });

  it("is silent and stays silent after a reload once muted", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setMuted(true);
    expect(storage.get("universum.soundMuted")).toBe("1");
    first.playDice();
    expect(FakeAudio.instances[0]?.plays ?? 0).toBe(0);

    const second = await loadAudio();
    expect(second.soundStore.getState().muted).toBe(true);
    second.playDice();
    expect(FakeAudio.instances[1]?.plays ?? 0).toBe(0);
  });

  it("plays again after unmuting, and remembers that too", async () => {
    stubBrowser();
    const first = await loadAudio();
    first.soundStore.getState().setMuted(true);
    first.soundStore.getState().setMuted(false);
    first.playDice();

    expect(storage.get("universum.soundMuted")).toBe("0");
    expect(FakeAudio.instances[0]?.plays).toBe(1);
  });

  it("unlocks the element on the first pointer press, once", async () => {
    stubBrowser();
    const { installAudioUnlock } = await loadAudio();

    installAudioUnlock();
    press("pointerdown");
    press("pointerdown");
    await Promise.resolve();

    expect(FakeAudio.instances[0]?.plays).toBe(1);
    expect(FakeAudio.instances[0]?.volume).toBe(1);
    expect(FakeAudio.instances[0]?.pauses).toBe(1);
  });

  it("unlocks without a sound when muted", async () => {
    stubBrowser();
    const { installAudioUnlock, soundStore } = await loadAudio();
    soundStore.getState().setMuted(true);

    installAudioUnlock();
    press("pointerdown");
    await Promise.resolve();

    expect(FakeAudio.instances[0]?.plays).toBe(1);
    expect(FakeAudio.instances[0]?.volume).toBe(1);
  });
});
