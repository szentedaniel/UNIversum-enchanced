/**
 * Pointer input on the Board's canvas (the prototype's `useZoomPan`): one
 * finger or the mouse drags, two fingers pinch around their midpoint, the
 * wheel zooms around the cursor, and a short still press is a tap.
 *
 * A press is a tap while it stays inside the slop of the pointer that landed
 * (`TAP_SLOP` for a mouse or pen, `TOUCH_TAP_SLOP` for a finger, whose contact
 * patch rolls) and ends within `TAP_MS`. The clock is injected so the tap's
 * duration is testable without waiting.
 */
import { zoomAround, type Camera } from "#board/camera.ts";
import type { Point } from "#board/layout.ts";

export type GestureTarget = {
  camera(): Camera;
  /** Moves the camera; the Board clamps it. */
  move(camera: Camera): void;
  scaleLimits(): { min: number; max: number };
  /** A tap at canvas CSS pixels. */
  tap(at: Point): void;
  /** The Player moved the camera by hand (drag, pinch or wheel). */
  moved(): void;
};

/** A press is a tap if it ends within this many milliseconds of landing. */
export const TAP_MS = 500;
/** Mouse and pen slop, canvas CSS px: the prototype's 10 px, kept for the desktop. */
export const TAP_SLOP = 10;
/** A finger's slop: its contact patch rolls and wobbles more than a mouse's. */
export const TOUCH_TAP_SLOP = 18;
const WHEEL_ZOOM = 0.002;

/** The clock a tap's duration is measured on; the browser's by default. */
export type GestureOptions = { now?: () => number };

/** The press from the first pointer down to the last pointer up. */
type Press = {
  /** Where the first pointer landed, in canvas CSS px. */
  start: Point;
  /** The clock reading when it landed. */
  at: number;
  /** The slop of the pointer that started the press. */
  slop: number;
  /** The press left the slop, so it is a drag and cannot be a tap. */
  moved: boolean;
};

/** The camera and the fingers a move is measured from. */
type Baseline = {
  camera: Camera;
  mid: Point;
  spread: number;
};

const midpoint = (points: Point[]): Point =>
  points.length >= 2 && points[0] && points[1]
    ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
    : (points[0] ?? { x: 0, y: 0 });

const spreadOf = (points: Point[]) =>
  points.length >= 2 && points[0] && points[1]
    ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    : 0;

/** Listens on `el`; returns the function that stops listening. */
export function attachGestures(
  el: HTMLElement,
  target: GestureTarget,
  options: GestureOptions = {},
): () => void {
  const now = options.now ?? (() => performance.now());
  const pointers = new Map<number, Point>();
  let press: Press | null = null;
  let baseline: Baseline | null = null;

  const local = (event: PointerEvent | WheelEvent): Point => {
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const clampScale = (scale: number) => {
    const { min, max } = target.scaleLimits();
    return Math.min(max, Math.max(min, scale));
  };

  /** (Re)starts the gesture from the current pointers, e.g. when a second finger lands. */
  function begin(): void {
    const points = [...pointers.values()];
    baseline = {
      camera: target.camera(),
      mid: midpoint(points),
      spread: spreadOf(points),
    };
  }

  function down(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (press === null) {
      press = {
        start: at,
        at: now(),
        slop: event.pointerType === "touch" ? TOUCH_TAP_SLOP : TAP_SLOP,
        moved: false,
      };
    }
    el.setPointerCapture?.(event.pointerId);
    begin();
  }

  function move(event: PointerEvent): void {
    if (!pointers.has(event.pointerId) || !baseline || !press) return;
    pointers.set(event.pointerId, local(event));
    const points = [...pointers.values()];
    const mid = midpoint(points);
    if (!press.moved) {
      const far = Math.hypot(mid.x - press.start.x, mid.y - press.start.y) >= press.slop;
      if (!far && points.length < 2) return;
      press.moved = true;
      target.moved();
    }
    const { camera, mid: from, spread } = baseline;
    const scale =
      points.length >= 2 && spread > 0
        ? clampScale(camera.scale * (spreadOf(points) / spread))
        : camera.scale;
    // Keep the Board point that was under the gesture's start midpoint under the current one.
    const zoomed = zoomAround(camera, from, scale);
    target.move({
      scale,
      x: zoomed.x + mid.x - from.x,
      y: zoomed.y + mid.y - from.y,
    });
  }

  function up(event: PointerEvent): void {
    if (!pointers.has(event.pointerId) || !press) return;
    const at = local(event);
    const isTap =
      !press.moved &&
      pointers.size === 1 &&
      event.type === "pointerup" &&
      now() - press.at < TAP_MS &&
      Math.hypot(at.x - press.start.x, at.y - press.start.y) < press.slop;
    pointers.delete(event.pointerId);
    if (pointers.size > 0) begin();
    else {
      press = null;
      baseline = null;
    }
    if (isTap) target.tap(at);
  }

  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const camera = target.camera();
    const scale = clampScale(camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM));
    target.moved();
    target.move(zoomAround(camera, local(event), scale));
  }

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
  };
}
