import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/**
 * The "desktop" layout (corner Player cards, side camera buttons): wide and
 * landscape with enough height. A landscape phone (852×393) is too short for
 * the corner cards and keeps the phone layout. Same query as the `wide:`
 * Tailwind variant in styles.css.
 */
export const WIDE_QUERY = "(min-width: 48rem) and (orientation: landscape) and (min-height: 36rem)";

export const useWide = (): boolean => useMediaQuery(WIDE_QUERY);
