import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatOpenTo } from "#chat/tray.ts";
import { ChatMuteToggle } from "#components/GameMenu.tsx";
import { PlayerCard, type PlayerSummary } from "#components/PlayerCard.tsx";
import { baseLocale, overwriteGetLocale } from "#paraglide/runtime.js";
import { chatStore } from "#stores/chat-store.ts";
import { CHAT_MUTED_KEY, chatMuteStore } from "#stores/chat-mute-store.ts";
import { SOUND_MUTED_KEY } from "#stores/sound-store.ts";
import en from "../messages/en.json" with { type: "json" };
import { viewOf } from "./playback-fixtures.ts";

// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written. The card reads the
// store through `useStore`; this hands it the state the store holds, as a
// mounted client reads it (same seam as chat-store.test.ts).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

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

const T0 = 1_000;

beforeEach(() => {
  stubStorage();
  storage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  chatMuteStore.getState().setMuted(false);
  chatStore.getState().reset();
});

afterEach(() => {
  chatStore.getState().reset();
  overwriteGetLocale(() => baseLocale);
  vi.useRealTimers();
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

describe("the muted bubbles", () => {
  it("drops a bubble that was on screen when the Guest mutes", () => {
    overwriteGetLocale(() => "en");
    chatStore.getState().show(1, "good_luck", T0);
    expect(renderCard()).toContain(BUBBLE);

    chatMuteStore.getState().setMuted(true);

    expect(renderCard()).not.toContain(BUBBLE);
  });

  it("keeps a bubble that arrived while muted hidden, even after unmuting", () => {
    overwriteGetLocale(() => "en");
    chatMuteStore.getState().setMuted(true);

    chatStore.getState().show(1, "good_luck", T0);
    expect(renderCard()).not.toContain(BUBBLE);

    chatMuteStore.getState().setMuted(false);
    expect(renderCard()).not.toContain(BUBBLE);

    chatStore.getState().show(1, "thanks", Date.now());
    expect(renderCard()).toContain("Thanks!");
  });
});

describe("the muted tray", () => {
  it("offers the quick-chat tray to a seated Guest only while unmuted", () => {
    expect(chatOpenTo(viewOf(), "p1", false)).toBe(true);
    expect(chatOpenTo(viewOf(), "p1", true)).toBe(false);
    expect(chatOpenTo(viewOf(), null, false)).toBe(false);
  });
});

describe("the Game menu's chat toggle", () => {
  it("labels the toggle with the setting it shows", () => {
    overwriteGetLocale(() => "en");
    chatMuteStore.getState().setMuted(false);

    const on = renderToStaticMarkup(createElement(ChatMuteToggle));

    expect(on).toContain('data-testid="chat-mute-toggle"');
    expect(on).toContain('aria-pressed="false"');
    expect(on).toContain(en.chat_on);

    chatMuteStore.getState().setMuted(true);
    const off = renderToStaticMarkup(createElement(ChatMuteToggle));

    expect(off).toContain('aria-pressed="true"');
    expect(off).toContain(en.chat_off);
  });
});
