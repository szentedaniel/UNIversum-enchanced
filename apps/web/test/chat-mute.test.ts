import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_MUTED_KEY, chatMuteStore } from "#stores/chat-mute-store.ts";
import { SOUND_MUTED_KEY } from "#stores/sound-store.ts";

// The quick-chat mute setting (#176, #232): one switch that hides the tray and
// every bubble on this device, remembered in localStorage like the sound mute.
// Its key is its own, so muting the sound never mutes chat nor the reverse.

const storage = new Map<string, string>();

function stubStorage({
  failRead = false,
  failWrite = false,
}: { failRead?: boolean; failWrite?: boolean } = {}) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (failRead) throw new Error("storage is blocked");
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error("storage is blocked");
      storage.set(key, value);
    },
  });
}

/** Loads the modules fresh, as a reloaded page would. */
async function loadStores() {
  vi.resetModules();
  const [mute, sound] = await Promise.all([
    import("#stores/chat-mute-store.ts"),
    import("#stores/sound-store.ts"),
  ]);
  return { mute: mute.chatMuteStore, sound: sound.soundStore };
}

beforeEach(() => {
  stubStorage();
  storage.clear();
  chatMuteStore.getState().setMuted(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the chat mute setting", () => {
  it("starts unmuted, and the toggle flips it both ways", () => {
    expect(chatMuteStore.getState().muted).toBe(false);

    chatMuteStore.getState().toggleMuted();
    expect(chatMuteStore.getState().muted).toBe(true);

    chatMuteStore.getState().toggleMuted();
    expect(chatMuteStore.getState().muted).toBe(false);
  });

  it("survives a reload, as a language switch causes", async () => {
    chatMuteStore.getState().setMuted(true);
    expect(storage.get(CHAT_MUTED_KEY)).toBe("1");

    const reloaded = await loadStores();

    expect(reloaded.mute.getState().muted).toBe(true);
  });

  it("keeps its own key, so the sound mute and the chat mute never touch each other", async () => {
    expect(CHAT_MUTED_KEY).not.toBe(SOUND_MUTED_KEY);
    storage.clear();
    const { mute, sound } = await loadStores();

    sound.getState().setMuted(true);
    expect(mute.getState().muted).toBe(false);
    expect(storage.get(SOUND_MUTED_KEY)).toBe("1");
    expect(storage.get(CHAT_MUTED_KEY)).toBeUndefined();

    mute.getState().setMuted(true);
    expect(sound.getState().muted).toBe(true);
    expect(storage.get(CHAT_MUTED_KEY)).toBe("1");
  });

  it("still applies on this page when storage refuses the write", () => {
    stubStorage({ failWrite: true });

    expect(() => chatMuteStore.getState().setMuted(true)).not.toThrow();
    expect(chatMuteStore.getState().muted).toBe(true);
  });

  it("starts unmuted when storage is unavailable", async () => {
    stubStorage({ failRead: true });

    const reloaded = await loadStores();

    expect(reloaded.mute.getState().muted).toBe(false);
  });
});
