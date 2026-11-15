# Ticket #245 (no sound file downloaded while everything is muted): extension points and gotchas

Branch `agent/issue-245-sound-download-no-sound-file-while-everything-is-m`, spec #178.
This changes the unlock that #243's handoff describes: it no longer makes every
element on the first gesture, only the ones the settings need.

## The lazy rule in `apps/web/src/audio.ts`

- `unlockElements()` is the one place elements are made: it reads `soundStore`
  and returns early while `effectsMuted && !musicOn` (nothing audible, so no
  file is downloaded). Otherwise it calls `unlockEffects()` (all cue pools) when
  the effects are on, and `unlockElement(musicElement())`; the music element is
  made even while `musicOn` is false, so its silent unlock covers a later toggle.
- `unlockAudio()` keeps its "first gesture only" flag and now just calls
  `unlockElements()` then `syncMusic()`. `unlockEffects()` is the old pool loop,
  moved out unchanged.
- The `soundStore.subscribe` in `audio.ts` reacts to a setting that turns a
  sound on: while the page is unlocked and the new state is audible it calls
  `unlockElements()` **synchronously in the toggle tap's call stack**. That is
  the iOS hazard: an `await` or timer before the silent `play()` loses the
  gesture, so a cue or the music toggle after being muted forever would be
  silent. The subscriber still calls `syncMusic()` on a `musicOn` change.
- `unlockedElements` (a `WeakSet`) makes `unlockElement` run once per element.
  It keeps a settings change from re-playing (and interrupting) an element that
  is already unlocked — e.g. the music, when the effects are toggled while it
  plays. `unlocking` (the `WeakMap` of pending silent plays) is unchanged; a cue
  or the music still waits for it so the unlock's `pause()` cannot stop them.
- Elements are made with `preload = "none"`, and `beginUnlock`/`start` set
  `preload = "auto"` before they play. Nothing is constructed at all while
  everything is muted, so the attribute only covers a created element whose
  play has not started yet.
- The stored keys and `soundStore`'s shape are untouched, and `playCue` still
  returns before creating anything while `effectsMuted`.

## Tests (`apps/web/test/sound.test.ts`)

- "creates no element on the first gesture while everything is muted" pins the
  no-construction rule (and the muted cue's no-op). "makes the pool and the
  music playable on the later tap that shows the effects" asserts the instances
  exist right after `setEffectsMuted(false)` without an `await` (the gesture
  call stack), then that a cue plays with no second tap. "adds the pool without
  restarting the music when the effects come on while it plays" pins the
  `unlockedElements` guard.
- Music side: "unlocks the music alone, silently, when only the music is on"
  and "starts the music on the tap that turns it on after a muted first
  gesture" (music only, no cue elements).
- The old "unlocks without a sound when the effects are off" test is gone: that
  unlock created every element while muted, which this ticket forbids. The
  other unlock tests are unchanged and still see `3 * Object.keys(CUES).length + 1`
  elements, because their settings leave the effects on.

## E2E

- Under `navigator.webdriver` the settings are the defaults (effects on), so the
  first gesture still makes the whole pool and the `two-guests` play counter
  (`window.dicePlays`) counts the same silent unlocks as before. A spec that
  mutes the effects and reloads changes nothing either: the counter is read
  after the taps, and the muted page makes no element until a toggle turns a
  sound on.
