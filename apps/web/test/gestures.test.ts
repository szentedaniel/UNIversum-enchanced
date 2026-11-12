import { describe, expect, it } from "vitest";
import type { Camera } from "#board/camera.ts";
import { attachGestures, TAP_MS, TAP_SLOP, TOUCH_TAP_SLOP } from "#board/gestures.ts";
import type { Point } from "#board/layout.ts";

// Board touch polish (#263): each decision in gestures.ts is pinned through the
// public GestureTarget interface with a seeded pointer sequence. The clock is
// injected, so no test waits; the Board's own clamping is not here (board.ts
// clamps the camera in `move`).

type Input = PointerEvent | WheelEvent;
type Listener = (event: Input) => void;

/** The canvas the gestures listen on: listeners, a rect and pointer capture. */
function fakeCanvas(origin: Point) {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((other) => other !== listener),
      );
    },
    getBoundingClientRect: () =>
      ({ left: origin.x, top: origin.y, width: 400, height: 400 }) as unknown as DOMRect,
    setPointerCapture: () => undefined,
    dispatch(type: string, event: Input) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

/** A mounted gesture listener with its camera, its calls and its fake clock. */
function mount(
  options: {
    camera?: Camera;
    limits?: { min: number; max: number };
    origin?: Point;
  } = {},
) {
  let clock = 0;
  let camera = options.camera ?? { scale: 1, x: 0, y: 0 };
  const limits = options.limits ?? { min: 0.5, max: 2 };
  const canvas = fakeCanvas(options.origin ?? { x: 0, y: 0 });
  const moves: Camera[] = [];
  const taps: Point[] = [];
  let moved = 0;
  let prevented = 0;

  attachGestures(
    canvas as unknown as HTMLElement,
    {
      camera: () => camera,
      move: (next) => {
        moves.push(next);
        camera = next;
      },
      scaleLimits: () => limits,
      tap: (at) => taps.push(at),
      moved: () => {
        moved += 1;
      },
    },
    { now: () => clock },
  );

  const pointer = (type: string, id: number, at: Point, pointerType: string) =>
    ({
      type,
      pointerId: id,
      clientX: at.x,
      clientY: at.y,
      pointerType,
      button: 0,
    }) as unknown as PointerEvent;

  return {
    at(ms: number) {
      clock = ms;
    },
    down(id: number, at: Point, pointerType = "touch") {
      canvas.dispatch("pointerdown", pointer("pointerdown", id, at, pointerType));
    },
    move(id: number, at: Point, pointerType = "touch") {
      canvas.dispatch("pointermove", pointer("pointermove", id, at, pointerType));
    },
    up(id: number, at: Point, pointerType = "touch") {
      canvas.dispatch("pointerup", pointer("pointerup", id, at, pointerType));
    },
    cancel(id: number, at: Point, pointerType = "touch") {
      canvas.dispatch("pointercancel", pointer("pointercancel", id, at, pointerType));
    },
    wheel(at: Point, deltaY: number) {
      canvas.dispatch("wheel", {
        type: "wheel",
        clientX: at.x,
        clientY: at.y,
        deltaY,
        preventDefault: () => {
          prevented += 1;
        },
      } as unknown as WheelEvent);
    },
    camera: () => camera,
    moves,
    taps,
    moved: () => moved,
    prevented: () => prevented,
  };
}

describe("tap", () => {
  it("taps a touch press inside the touch slop and inside TAP_MS, without moving the camera", () => {
    const board = mount();
    board.at(0);
    board.down(1, { x: 100, y: 100 });
    board.at(100);
    board.move(1, { x: 100 + TOUCH_TAP_SLOP - 1, y: 100 });
    board.at(TAP_MS - 1);
    board.up(1, { x: 100 + TOUCH_TAP_SLOP - 1, y: 100 });

    expect(board.taps).toEqual([{ x: 100 + TOUCH_TAP_SLOP - 1, y: 100 }]);
    expect(board.moved()).toBe(0);
    expect(board.moves).toEqual([]);
  });

  it("drags a touch press at the touch slop or after TAP_MS", () => {
    const far = mount();
    far.at(0);
    far.down(1, { x: 100, y: 100 });
    far.at(100);
    far.move(1, { x: 100 + TOUCH_TAP_SLOP, y: 100 });
    far.at(TAP_MS - 1);
    far.up(1, { x: 100 + TOUCH_TAP_SLOP, y: 100 });

    expect(far.taps).toEqual([]);
    expect(far.moved()).toBe(1);

    const slow = mount();
    slow.at(0);
    slow.down(1, { x: 100, y: 100 });
    slow.at(TAP_MS);
    slow.up(1, { x: 100, y: 100 });

    expect(slow.taps).toEqual([]);
    expect(slow.moved()).toBe(0);
  });

  it("keeps the prototype's tighter slop for a mouse", () => {
    const board = mount();
    board.at(0);
    board.down(1, { x: 100, y: 100 }, "mouse");
    board.at(100);
    board.move(1, { x: 100 + TAP_SLOP - 1, y: 100 }, "mouse");
    board.at(200);
    board.up(1, { x: 100 + TAP_SLOP - 1, y: 100 }, "mouse");

    expect(board.taps).toEqual([{ x: 100 + TAP_SLOP - 1, y: 100 }]);
    expect(board.moved()).toBe(0);

    const drag = mount();
    drag.at(0);
    drag.down(1, { x: 100, y: 100 }, "mouse");
    drag.at(100);
    drag.move(1, { x: 100 + TAP_SLOP, y: 100 }, "mouse");
    drag.at(200);
    drag.up(1, { x: 100 + TAP_SLOP, y: 100 }, "mouse");

    expect(drag.taps).toEqual([]);
    expect(drag.moved()).toBe(1);
  });

  it("reports a tap in canvas CSS pixels, not viewport pixels", () => {
    const board = mount({ origin: { x: 40, y: 24 } });
    board.at(0);
    board.down(1, { x: 140, y: 124 });
    board.at(100);
    board.up(1, { x: 140, y: 124 });

    expect(board.taps).toEqual([{ x: 100, y: 100 }]);
  });
});
