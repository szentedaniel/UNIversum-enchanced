/**
 * Pointer input on the Board's canvas (the prototype's `useZoomPan`): one
 * finger or the mouse drags, two fingers pinch around their midpoint, the
 * wheel zooms around the cursor, and a short still press is a tap.
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

/** A press is a tap if it moves less than this and ends within `TAP_MS`. */
const TAP_SLOP = 10;
const TAP_MS = 500;
const WHEEL_ZOOM = 0.002;

type Gesture = {
  camera: Camera;
  mid: Point;
  spread: number;
  start: Point;
  at: number;
  moved: boolean;
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
export function attachGestures(el: HTMLElement, target: GestureTarget): () => void {
  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null;

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
    const mid = midpoint(points);
    gesture = {
      camera: target.camera(),
      mid,
      spread: spreadOf(points),
      start: gesture?.start ?? mid,
      at: gesture?.at ?? performance.now(),
      moved: gesture?.moved ?? false,
    };
  }

  function down(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    el.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) gesture = null;
    begin();
  }

  function move(event: PointerEvent): void {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, local(event));
    const points = [...pointers.values()];
    const mid = midpoint(points);
    if (!gesture.moved) {
      const far = Math.hypot(mid.x - gesture.start.x, mid.y - gesture.start.y) > TAP_SLOP;
      if (!far && points.length < 2) return;
      gesture.moved = true;
      target.moved();
    }
    const { camera, spread } = gesture;
    const scale =
      points.length >= 2 && spread > 0
        ? clampScale(camera.scale * (spreadOf(points) / spread))
        : camera.scale;
    // Keep the Board point that was under the gesture's start midpoint under the current one.
    const zoomed = zoomAround(camera, gesture.mid, scale);
    target.move({
      scale,
      x: zoomed.x + mid.x - gesture.mid.x,
      y: zoomed.y + mid.y - gesture.mid.y,
    });
  }

  function up(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    const isTap =
      gesture !== null &&
      !gesture.moved &&
      pointers.size === 1 &&
      performance.now() - gesture.at < TAP_MS;
    const at = local(event);
    pointers.delete(event.pointerId);
    if (pointers.size > 0) begin();
    else gesture = null;
    if (isTap && event.type === "pointerup") target.tap(at);
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
