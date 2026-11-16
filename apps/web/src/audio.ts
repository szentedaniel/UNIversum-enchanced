/**
 * The sound cues and the background music (spec #178): a named cue plays
 * through a small pool of `HTMLAudioElement`s, so two cues in quick succession
 * do not cut each other off, and one looping element carries the music. Every
 * element is unlocked on the first tap or key press (iOS only plays audio a
 * gesture started); one created after that is unlocked when it is made. While
 * every sound is muted the first gesture only records itself and makes
 * nothing, so a Guest who silenced the game downloads no audio; the tap that
 * turns a setting on creates and unlocks what it needs, being a gesture too.
 * The menu's effects toggle silences the cues, its music toggle starts or
 * pauses the music, and under browser automation the elements start muted, so
 * `play()` is still called and can be counted.
 */
import musicSound from "#assets/sounds/music.mp3";
import { CUES, type CueName } from "#sound/cues.ts";
import { soundStore } from "#stores/sound-store.ts";

export { soundStore };

declare const TEST_HOOKS_ENABLED: boolean;

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
/** Elements whose silent unlock has started: the unlock runs once per element. */
const unlockedElements = new WeakSet<HTMLAudioElement>();
/** Elements whose silent unlock has not finished: a cue waits for it so it is audible. */
const unlocking = new WeakMap<HTMLAudioElement, Promise<void>>();
/** The one music element, made by the first unlock that needs it. */
let music: HTMLAudioElement | null = null;
/** Whether a `play()` for the music is under way. */
let musicPlaying = false;
/** Invalidates a start still waiting for the unlock or an earlier play's failure. */
let musicAttempt = 0;

function isCueName(name: string): name is CueName {
  return name in CUES;
}

function poolFor(name: CueName): Pool {
  let pool = pools.get(name);
  if (!pool) {
    pool = { elements: Array.from({ length: POOL_SIZE }, () => null), next: 0 };
    pools.set(name, pool);
  }
  return pool;
}

/** The element in `slot`, created (and unlocked, once audio is unlocked) on first use. */
function elementAt(name: CueName, pool: Pool, slot: number): HTMLAudioElement {
  const pooled = pool.elements[slot];
  if (pooled) return pooled;

  const element = new Audio(CUES[name]);
  // No download until the unlock or a cue plays it.
  element.preload = "none";
  if (navigator.webdriver) element.muted = true;
  pool.elements[slot] = element;
  if (unlocked) unlockElement(element);
  return element;
}

/** The cue's next element, round-robin. */
function elementFor(name: CueName): HTMLAudioElement {
  const pool = poolFor(name);
  const slot = pool.next;
  pool.next = (slot + 1) % POOL_SIZE;
  return elementAt(name, pool, slot);
}

/** Starts `element` silently and pauses it again: the iOS unlock, without a sound. */
function beginUnlock(element: HTMLAudioElement): Promise<void> {
  const volume = element.volume;
  element.preload = "auto";
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

/** Unlocks one element once, remembering the wait so a cue cannot start under its silent play. */
function unlockElement(element: HTMLAudioElement): void {
  if (unlockedElements.has(element)) return;
  unlockedElements.add(element);
  const done = beginUnlock(element);
  unlocking.set(element, done);
  void done.then(() => unlocking.delete(element));
}

/** Restarts the element from the beginning and plays it. A failed play (no gesture yet) is silent. */
function start(element: HTMLAudioElement): void {
  element.preload = "auto";
  element.currentTime = 0;
  void element.play().catch(() => {});
}

/** Plays counted per cue for the e2e specs; only a test build records them. */
const cueCounts: Record<CueName, number> = {
  dice: 0,
  buy: 0,
  rent: 0,
  chance: 0,
  quarantine: 0,
  release: 0,
  bankrupt: 0,
  gameEnd: 0,
};

/** Records one play of `name`; only a test build calls this. */
function countPlay(name: CueName): void {
  cueCounts[name] += 1;
}

/** How many times each cue played since this page loaded. */
export function cuePlays(): Record<CueName, number> {
  return { ...cueCounts };
}

/** Plays a cue, unless muted. A cue on an element unlocked a moment ago follows the unlock. */
export function playCue(name: CueName): void {
  if (soundStore.getState().effectsMuted) return;
  // No audio outside a browser: the store's vitest drives the cues' caller in Node.
  if (typeof Audio === "undefined") return;
  if (TEST_HOOKS_ENABLED) countPlay(name);
  const sound = elementFor(name);
  const pending = unlocking.get(sound);
  if (pending) void pending.then(() => start(sound));
  else start(sound);
}

/** Whether the tab is hidden, which pauses the music (no `document` outside a browser). */
function tabHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** The music element: one looping track, muted under automation like the cues. */
function musicElement(): HTMLAudioElement {
  if (music) return music;
  const element = new Audio(musicSound);
  element.loop = true;
  // No download until the unlock starts it.
  element.preload = "none";
  if (navigator.webdriver) element.muted = true;
  // A pause the browser or the OS makes (an interruption, a lost audio focus)
  // forgets the play, so the next wake restarts the track; `stopMusic` and the
  // unlock's silent pause run with the flag already off, so they cannot land
  // here, and a looped track never ends, so it needs no `ended` listener.
  element.addEventListener("pause", () => {
    if (musicPlaying) musicPlaying = false;
  });
  music = element;
  return element;
}

/** Starts the music, waiting for the unlock's silent play first so its pause cannot stop it. */
function startMusic(): void {
  if (musicPlaying) return;
  const element = musicElement();
  const attempt = ++musicAttempt;
  const play = () => {
    if (attempt !== musicAttempt) return;
    musicPlaying = true;
    // A rejected play (no gesture, or a pause under it) leaves the flag off, so the next wake retries.
    void element.play().catch(() => {
      if (attempt === musicAttempt) musicPlaying = false;
    });
  };
  const pending = unlocking.get(element);
  if (pending) void pending.then(play);
  else play();
}

/** Pauses the music, and cancels a start still waiting for the unlock. */
function stopMusic(): void {
  musicAttempt += 1;
  if (!musicPlaying) return;
  musicPlaying = false;
  music?.pause();
}

/**
 * The music follows its setting, the unlock and the tab, never the Room: on,
 * visible and unlocked it plays, otherwise it pauses. The unlock and the
 * toggle tap both land here, so the tap that turns it on is the gesture.
 */
function syncMusic(): void {
  // No audio outside a browser: the store's vitest drives the settings in Node.
  if (typeof Audio === "undefined") return;
  if (unlocked && soundStore.getState().musicOn && !tabHidden()) startMusic();
  else stopMusic();
}

/**
 * Creates and silently unlocks every pooled cue element inside the gesture:
 * iOS honours a later play only on an element a gesture started, so a lazily
 * made first one would be silent.
 */
function unlockEffects(): void {
  for (const name of Object.keys(CUES)) {
    if (!isCueName(name)) continue;
    const pool = poolFor(name);
    for (let slot = 0; slot < POOL_SIZE; slot++) {
      const existing = pool.elements[slot];
      if (existing) unlockElement(existing);
      else elementAt(name, pool, slot);
    }
  }
}

/**
 * Creates and silently unlocks the elements the settings need, inside the
 * gesture that makes them audible. With everything muted it makes nothing, so
 * no sound file is downloaded for a sound nobody will hear; each element is
 * unlocked once, so a later setting change only covers the elements it adds.
 */
function unlockElements(): void {
  // No audio outside a browser: the store's vitest drives the settings in Node.
  if (typeof Audio === "undefined") return;
  const { effectsMuted, musicOn } = soundStore.getState();
  if (effectsMuted && !musicOn) return;
  if (!effectsMuted) unlockEffects();
  // The music is part of every element the unlock covers; it starts only if it is on.
  unlockElement(musicElement());
}

/**
 * Makes the elements the settings need playable from the next event: call it
 * inside the first gesture and start each silently, then pause it again. After
 * that, `playCue` works without a gesture, as iOS requires, the music starts
 * if it is on, and an element created later is unlocked when it is made.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  if (typeof Audio === "undefined") return;
  unlockElements();
  syncMusic();
}

/** The first gesture's listener: unlock, then stop listening. */
function unlock(): void {
  unlockAudio();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}

/** Unlocks the cues and the music on this page's first pointer press or key press. */
export function installAudioUnlock(): void {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// A setting that turns a sound on is itself a gesture: make and silently unlock
// the elements it needs inside that tap, so a later cue or the music needs no
// second one, and the music starts or pauses with its toggle.
soundStore.subscribe((state, previous) => {
  const audible = !state.effectsMuted || state.musicOn;
  const changed =
    state.effectsMuted !== previous.effectsMuted || state.musicOn !== previous.musicOn;
  if (unlocked && changed && audible) unlockElements();
  if (state.musicOn !== previous.musicOn) syncMusic();
});

// A hidden tab pauses the music; showing it resumes the music if it is still on.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", syncMusic);
}
