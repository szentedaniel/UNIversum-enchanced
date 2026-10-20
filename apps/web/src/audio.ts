/**
 * The dice sound: one `HTMLAudioElement`, unlocked on the first tap or key
 * press (iOS only plays audio a gesture started), then played whenever a
 * `DiceRolled` event arrives. The in-game menu's mute toggle silences it.
 */
import diceSound from "#assets/sounds/dice.mp3";
import { soundStore } from "#stores/sound-store.ts";

export { soundStore };

let element: HTMLAudioElement | null = null;
let unlocked = false;

/**
 * The one dice-sound element. Under browser automation (Playwright sets
 * `navigator.webdriver`) it starts muted, so test runs stay silent while
 * `play()` is still called and can be counted.
 */
function diceElement(): HTMLAudioElement {
  if (!element) {
    element = new Audio(diceSound);
    if (navigator.webdriver) element.muted = true;
  }
  return element;
}

/** Plays the dice sound, unless muted. A failed play (no gesture yet) is silent. */
export function playDice(): void {
  if (soundStore.getState().muted) return;
  const sound = diceElement();
  sound.currentTime = 0;
  void sound.play().catch(() => {});
}

/**
 * Makes the element playable from the next event: call it inside the first
 * gesture and start it silently, then pause it again. After that, `playDice`
 * works without a gesture, as iOS requires.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const sound = diceElement();
  const volume = sound.volume;
  sound.volume = 0;
  void (async () => {
    try {
      await sound.play();
      sound.pause();
      sound.currentTime = 0;
    } catch {
      // Ignore: a play started by a real tap later can still succeed.
    } finally {
      sound.volume = volume;
    }
  })();
}

/** The first gesture's listener: unlock, then stop listening. */
function unlock(): void {
  unlockAudio();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}

/** Unlocks the dice sound on this page's first pointer press or key press. */
export function installAudioUnlock(): void {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
