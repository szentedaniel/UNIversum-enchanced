import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundToggles } from "#components/SoundToggles.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { Home } from "#screens/Home.tsx";
import { MUSIC_ON_KEY, SOUND_MUTED_KEY, soundStore } from "#stores/sound-store.ts";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };

// The sound controls on Home (#244): a Guest silences the game before joining.
// Home draws the menu's two toggles compact (icon-sized, the label moved to
// `aria-label`), reading the same `soundStore`, so a choice made here holds in
// the Room and after a reload. Home and the menu are never on screen together,
// which is why both keep the `sound-toggle` / `music-toggle` test ids.
//
// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written; the toggles read the
// store through `useStore`, so this hands them the state the store holds, as a
// mounted client reads it (same seam as chat-mute.test.ts).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

const storage = new Map<string, string>();

/** Home's markup, through the router its links need (Home itself is the screen). */
const renderHome = () =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Home)));

/** The compact toggles as Home draws them; the menu renders the full form. */
const renderCompact = () => renderToStaticMarkup(createElement(SoundToggles, { compact: true }));

/**
 * Loads the store fresh, as a reloaded page would: the stored choices are read
 * on import, so a static import (loaded once, before the stubs) cannot show them.
 */
async function reloadStore() {
  vi.resetModules();
  return (await import("#stores/sound-store.ts")).soundStore;
}

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  storage.clear();
  inLanguage("en");
  soundStore.getState().setEffectsMuted(false);
  soundStore.getState().setMusicOn(false);
});

afterEach(() => {
  inLanguage(baseLocale);
  vi.unstubAllGlobals();
});

describe("the sound controls on Home", () => {
  it("draws both toggles, under the test ids the menu uses", () => {
    const home = renderHome();

    expect(home).toContain('data-testid="sound-toggle"');
    expect(home).toContain('data-testid="music-toggle"');
  });

  it("keeps its other controls unchanged around them", () => {
    const home = renderHome();

    expect(home).toContain('href="/create"');
    expect(home).toContain('href="/rooms"');
    expect(home).toContain('data-testid="language-en"');
    expect(home).toContain('class="join sticker');
  });

  it("wraps the compact row, so a 360 px phone needs no sideways scroll", () => {
    expect(renderCompact()).toContain("flex-wrap");
  });

  it("labels the icon-sized toggles from the messages, in hu, en and de", () => {
    inLanguage("en");
    const on = renderCompact();
    expect(on).toContain(`aria-label="${en.sound_on}"`);
    expect(on).toContain(`aria-label="${en.music_off}"`);
    expect(on).not.toContain(`>${en.sound_on}<`);
    expect(on).not.toContain(`>${en.music_off}<`);

    inLanguage("hu");
    const hungarian = renderCompact();
    expect(hungarian).toContain(`aria-label="${hu.sound_on}"`);
    expect(hungarian).toContain(`aria-label="${hu.music_off}"`);

    soundStore.getState().setEffectsMuted(true);
    soundStore.getState().setMusicOn(true);
    inLanguage("de");
    const german = renderCompact();
    expect(german).toContain(`aria-label="${de.sound_off}"`);
    expect(german).toContain(`aria-label="${de.music_on}"`);
  });

  it("keeps the menu's full form as it was: the labels written out, no aria-label", () => {
    const full = renderToStaticMarkup(createElement(SoundToggles));

    expect(full).toContain(`>${en.sound_on}<`);
    expect(full).toContain(`>${en.music_off}<`);
    expect(full).not.toContain("aria-label");
  });

  it("presses with the store, so a choice made in the menu shows on Home", () => {
    soundStore.getState().setEffectsMuted(true);
    soundStore.getState().setMusicOn(true);
    const pressed = renderCompact();
    expect(pressed.match(/aria-pressed="true"/g)).toHaveLength(2);

    soundStore.getState().setEffectsMuted(false);
    soundStore.getState().setMusicOn(false);
    const released = renderCompact();
    expect(released.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it("remembers a toggle in localStorage, and a reloaded page starts with it", async () => {
    soundStore.getState().toggleEffectsMuted();
    soundStore.getState().toggleMusicOn();

    expect(storage.get(SOUND_MUTED_KEY)).toBe("1");
    expect(storage.get(MUSIC_ON_KEY)).toBe("1");

    const reloaded = await reloadStore();
    expect(reloaded.getState()).toMatchObject({ effectsMuted: true, musicOn: true });
  });
});
