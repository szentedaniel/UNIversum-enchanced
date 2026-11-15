import { describe, expect, it } from "vitest";
import { fieldHoverReporter, snapField } from "#board/board.ts";
import { hoverEligible, TOUCH_WHEEL_GRACE_MS } from "#board/gestures.ts";
import type { Point } from "#board/layout.ts";

// Board hover (#317): the pure rules behind the Field tooltip — whether a
// pointer move may report a hover, which Field a pointer snaps to, and the
// change-only report. No timers and no Pixi: `board.ts` exports the snap, and
// only `createBoard` touches the renderer.

const point = (x: number, y: number): Point => ({ x, y });

/** A pointer move that may hover: a mouse, nothing pressed, no touch about. */
const eligibleMove = {
  pointerType: "mouse",
  buttons: 0,
  dragging: false,
  multi: false,
  sinceTouch: null,
} as const;

describe("hoverEligible", () => {
  it("accepts a mouse with no button pressed and no recent touch", () => {
    expect(hoverEligible(eligibleMove)).toBe(true);
  });

  it("rejects a touch or pen pointer, whose compatibility mouse moves are not a hover", () => {
    expect(hoverEligible({ ...eligibleMove, pointerType: "touch" })).toBe(false);
    expect(hoverEligible({ ...eligibleMove, pointerType: "pen" })).toBe(false);
  });

  it("rejects any pressed button", () => {
    expect(hoverEligible({ ...eligibleMove, buttons: 1 })).toBe(false);
    expect(hoverEligible({ ...eligibleMove, buttons: 2 })).toBe(false);
  });

  it("rejects a drag, a pinch or a second pointer", () => {
    expect(hoverEligible({ ...eligibleMove, dragging: true })).toBe(false);
    expect(hoverEligible({ ...eligibleMove, multi: true })).toBe(false);
  });

  it("rejects a hover within the touch grace and accepts it after", () => {
    expect(hoverEligible({ ...eligibleMove, sinceTouch: 0 })).toBe(false);
    expect(hoverEligible({ ...eligibleMove, sinceTouch: TOUCH_WHEEL_GRACE_MS - 1 })).toBe(false);
    expect(hoverEligible({ ...eligibleMove, sinceTouch: TOUCH_WHEEL_GRACE_MS })).toBe(true);
  });
});

describe("snapField", () => {
  it("returns the nearest Field within the tap reach", () => {
    const centres = [point(0, 0), point(100, 0)];

    expect(snapField(point(40, 0), centres, 1)).toBe(0);
    expect(snapField(point(60, 0), centres, 1)).toBe(1);
  });

  it("keeps the lower Field id when two Fields are equally near, as tap() always has", () => {
    expect(snapField(point(50, 0), [point(50, 50), point(50, -50)], 1)).toBe(0);
  });

  it("returns null beyond the tap reach, where a tap still closes the card", () => {
    // Scale 0.2 puts 1.6 × 129 px × 0.2 below the 90 px floor, so the reach is 90 px.
    expect(snapField(point(90, 0), [point(0, 0)], 0.2)).toBe(0);
    expect(snapField(point(91, 0), [point(0, 0)], 0.2)).toBeNull();
  });

  it("widens the reach with the camera above the 90 px floor", () => {
    // Scale 1: 1.6 × FIELD_WIDTH = 206.4 px, the spec's reach ('Taps').
    expect(snapField(point(200, 0), [point(0, 0)], 1)).toBe(0);
    expect(snapField(point(210, 0), [point(0, 0)], 1)).toBeNull();
  });

  it("counts only the Fields the filter allows, as a tap does during a pick", () => {
    const centres = [point(0, 0), point(50, 0)];

    expect(snapField(point(20, 0), centres, 1, (id) => id !== 0)).toBe(1);
    expect(snapField(point(20, 0), centres, 1, () => false)).toBeNull();
  });

  it("skips a Field id with no centre", () => {
    const centres: Point[] = [];
    centres[4] = point(0, 0);

    expect(snapField(point(10, 0), centres, 1)).toBe(4);
  });
});

describe("fieldHoverReporter", () => {
  it("reports a Field only when it changes, and null only once", () => {
    const seen: (number | null)[] = [];
    const report = fieldHoverReporter((id) => seen.push(id));

    for (const id of [3, 3, 5, 5, null, null, 3]) report(id);

    expect(seen).toEqual([3, 5, null, 3]);
  });
});
