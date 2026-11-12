/**
 * Which hints this browser has shown (spec #180): the seen set and the hints
 * switch, kept in `localStorage` next to the sound mute and the pick
 * checklist. A dismissed hint never returns; an id the table no longer knows
 * is dropped on read. Storage can be blocked, so every read and write swallows
 * its failure, as `sound-store.ts` does.
 */
import { createStore } from "zustand/vanilla";
import { isHintId, type HintId } from "#hints/hints.ts";

export const HINT_SEEN_KEY = "universum.hintsSeen";
export const HINT_ENABLED_KEY = "universum.hintsEnabled";

function storedSeen(): ReadonlySet<HintId> {
  try {
    const raw = localStorage.getItem(HINT_SEEN_KEY);
    if (raw === null) return new Set();
    const stored: unknown = JSON.parse(raw);
    return Array.isArray(stored) ? new Set(stored.filter(isHintId)) : new Set();
  } catch {
    // Storage can be unavailable or hold a value another version wrote: start empty.
    return new Set();
  }
}

function storedEnabled(): boolean {
  try {
    return localStorage.getItem(HINT_ENABLED_KEY) !== "0";
  } catch {
    // Storage can be unavailable (private mode, a blocked origin): hints stay on.
    return true;
  }
}

function rememberSeen(seen: ReadonlySet<HintId>): void {
  try {
    localStorage.setItem(HINT_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // The hint stays dismissed on this page; it just won't be remembered.
  }
}

function rememberEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HINT_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // The switch still applies to this page.
  }
}

export type HintState = {
  /** The hints already shown (or dismissed) in this browser. */
  seen: ReadonlySet<HintId>;
  /** The hints switch; off hides every hint row. */
  enabled: boolean;
  /** Marks a hint as seen: it never returns at its trigger. */
  dismiss(id: HintId): void;
  setEnabled(enabled: boolean): void;
  /** Shows every hint again at its next trigger, with hints on. */
  reset(): void;
};

export const hintStore = createStore<HintState>()((set, get) => ({
  seen: storedSeen(),
  enabled: storedEnabled(),
  dismiss: (id) => {
    if (get().seen.has(id)) return;
    const seen = new Set(get().seen).add(id);
    rememberSeen(seen);
    set({ seen });
  },
  setEnabled: (enabled) => {
    rememberEnabled(enabled);
    set({ enabled });
  },
  reset: () => {
    const seen = new Set<HintId>();
    rememberSeen(seen);
    rememberEnabled(true);
    set({ seen, enabled: true });
  },
}));
