/**
 * The sound cues (spec #178): a named cue plays through a small pool of
 * `HTMLAudioElement`s, so two cues in quick succession do not cut each other
 * off. Elements are unlocked on the first tap or key press (iOS only plays
 * audio a gesture started); one created after that is unlocked when it is
 * made. The in-game menu's mute toggle silences every cue, and under browser
 * automation the elements start muted, so `play()` is still called and can be
 * counted.
 */
import { CUES, type CueName } from "#sound/cues.ts";
import { soundStore } from "#stores/sound-store.ts";

export { soundStore };

/** How many elements each cue rotates through: a repeated cue restarts without cutting itself off. */
const POOL_SIZE = 3;

type Pool = {
  /** The cue's elements, `null` in a slot not used yet. */
  elements: (HTMLAudioElement | null)[];
  /** The next slot to play, round-robin. */
  next: number;
};

const pools = new Map<CueName, Pool>();
let unlocked = false;
/** Elements whose silent unlock has not finished: a cue waits for it so it is audible. */
const unlocking = new WeakMap<HTMLAudioElement, Promise<void>>();

/** The cue's next element, created (and unlocked, once audio is unlocked) on first use. */
function elementFor(name: CueName): HTMLAudioElement {
  let pool = pools.get(name);
  if (!pool) {
    pool = { elements: Array.from({ length: POOL_SIZE }, () => null), next: 0 };
    pools.set(name, pool);
  }
  const slot = pool.next;
  pool.next = (slot + 1) % POOL_SIZE;
  const pooled = pool.elements[slot];
  if (pooled) return pooled;

  const element = new Audio(CUES[name]);
  if (navigator.webdriver) element.muted = true;
  pool.elements[slot] = element;
  if (unlocked) unlockElement(element);
  return element;
}

/** Starts `element` silently and pauses it again: the iOS unlock, without a sound. */
function beginUnlock(element: HTMLAudioElement): Promise<void> {
  const volume = element.volume;
  element.volume = 0;
  return (async () => {
    try {
      await element.play();
      element.pause();
      element.currentTime = 0;
    } catch {
      // Ignore: a play started by a real tap later can still succeed.
    } finally {
      element.volume = volume;
    }
  })();
}

/** Unlocks one element, remembering the wait so a cue cannot start under its silent play. */
function unlockElement(element: HTMLAudioElement): void {
  const done = beginUnlock(element);
  unlocking.set(element, done);
  void done.then(() => unlocking.delete(element));
}

/** Restarts the element from the beginning and plays it. A failed play (no gesture yet) is silent. */
function start(element: HTMLAudioElement): void {
  element.currentTime = 0;
  void element.play().catch(() => {});
}

/** Plays a cue, unless muted. A cue on an element unlocked a moment ago follows the unlock. */
export function playCue(name: CueName): void {
  if (soundStore.getState().muted) return;
  // No audio outside a browser: the store's vitest drives the cues' caller in Node.
  if (typeof Audio === "undefined") return;
  const sound = elementFor(name);
  const pending = unlocking.get(sound);
  if (pending) void pending.then(() => start(sound));
  else start(sound);
}

/**
 * Makes every pooled element playable from the next event: call it inside the
 * first gesture and start each silently, then pause it again. After that,
 * `playCue` works without a gesture, as iOS requires, and an element created
 * later is unlocked when it is made.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  for (const pool of pools.values()) {
    for (const element of pool.elements) {
      if (element) unlockElement(element);
    }
  }
}

/** The first gesture's listener: unlock, then stop listening. */
function unlock(): void {
  unlockAudio();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}

/** Unlocks the cues on this page's first pointer press or key press. */
export function installAudioUnlock(): void {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
