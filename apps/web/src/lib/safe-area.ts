/**
 * What a phone actually shows a focused input: `window.visualViewport` shrinks
 * when the on-screen keyboard opens, while an element's rectangle is measured
 * against the layout viewport. App.tsx scrolls a field this hides back into
 * view; this is the decision it asks.
 */

/** Space kept between a focused field and the top and bottom of the visible area. */
const FIELD_MARGIN = 12;

/** Whether the visible area shows the whole of `field`, clear of its edges. */
export function fieldVisible(
  field: { top: number; bottom: number },
  area: { offsetTop: number; height: number },
  margin = FIELD_MARGIN,
): boolean {
  return (
    field.top >= area.offsetTop + margin && field.bottom <= area.offsetTop + area.height - margin
  );
}
