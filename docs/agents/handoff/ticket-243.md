# Ticket #243 (background music, separate effects and music toggles): extension points and gotchas

Branch `agent/issue-243-sound-background-music-and-separate-effects-music`.

## Settings

- `#stores/sound-store.ts` holds two flags: `effectsMuted` (the cues) and `musicOn` (off by
  default). `SOUND_MUTED_KEY` is still `universum.soundMuted`, so an existing mute silences the
  effects; the music has `MUSIC_ON_KEY` = `universum.musicOn`. Setters: `setEffectsMuted` /
  `toggleEffectsMuted` and `setMusicOn` / `toggleMusicOn`; both read and write storage inside a
  `try`, so unavailable storage still applies for the page.
- `playCue` reads `effectsMuted` and never looks at `musicOn`. Anything that used
  `soundStore.muted` before reads `effectsMuted` instead (only `audio.ts` and the tests did).

## Music

- `#audio.ts` imports `#assets/sounds/music.mp3` itself and owns one `HTMLAudioElement` for it, with
  `loop = true` and `muted` under `navigator.webdriver` like the cues. The track stays out of
  `CUES`: the cue table remains one row per event, and the music is not a cue.
- The element is created on the first unlock: `unlockAudio` silently unlocks every pooled cue
  element and then the music, so a later `musicOn` toggle needs no extra gesture. The music is the
  extra element in the unlock's count (`3 * CUES + 1`).
- `syncMusic` is the one rule: it plays only while the page is unlocked, `musicOn` is true and
  `document.hidden` is false; otherwise it pauses. Two import-time hooks call it: a
  `soundStore.subscribe` on a `musicOn` change (the toggle tap, which is also a gesture) and a
  `visibilitychange` listener on `document`. It follows the setting only — no Room, no screen — so
  the Lobby, the Game and a language reload (which restarts from the stored choice on the first
  gesture) sound the same.
- `startMusic` waits for the unlock's silent play so its `pause()` cannot stop the music, and
  `musicAttempt` invalidates a start still waiting for the unlock or for an earlier `play()`'s
  failure, so a quick off/on cannot leave the flag stuck. A rejected `play()` (no gesture, a pause
  under it) leaves the music stopped; the next toggle or visibility wake retries.
- `apps/web/assets/sounds/music.mp3` is a placeholder copy of `dice.mp3` with its `LICENSES.md`
  row; the owner replaces both.

## UI and messages

- `#components/SoundToggles.tsx`: `sound-toggle` (effects; `aria-pressed` is the muted flag,
  `Volume2`/`VolumeX`, `sound_on`/`sound_off`) and `music-toggle` (music; `aria-pressed` is the
  `musicOn` flag, `Music`/`Music2`, `music_on`/`music_off`). `GameMenu.tsx` renders it between the
  language picker and `ChatMuteToggle`.
- New messages `music_on`/`music_off` in hu/en/de; run
  `pnpm --filter @universum/web run paraglide` after editing them.

## Tests

- `apps/web/test/sound.test.ts` stubs `document` (`hidden` as a live getter, plus
  `addEventListener`/`removeEventListener`) beside `window`, and `FakeAudio` records `loop`. The
  music tests drive the settings through the store and read the element's `plays`/`pauses`.
- `apps/web/test/chat-mute.test.ts` reads `effectsMuted`; its key test still pins that the chat
  mute and the effects mute never touch each other.

## Gotchas

- Do not touch `window` or `document` at import time without a guard: `audio.ts` is imported in
  Node by the Playback store's tests, where neither exists. The `document` listener sits behind
  `typeof document !== "undefined"`; `installAudioUnlock` is the only `window` touch and runs
  explicitly from `main.tsx`.
- `vi.resetModules()` + dynamic `import("#audio.ts")` gives the module a fresh `sound-store`
  instance, so the test file's static `import { MUSIC_ON_KEY } from "#stores/sound-store.ts"` is a
  different store instance than the one the freshly loaded audio module drives. The imported keys
  are plain strings, which is why the tests only use those.
- The music adds one `play()` per first gesture (its silent unlock), so a spec that counts
  `window.dicePlays` must keep comparing against a value read after the taps, as `two-guests` does.
