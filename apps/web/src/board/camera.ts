/**
 * Camera maths (from the board-phone prototype, variant E). A camera maps
 * Board units to canvas CSS pixels: `screen = board × scale + (x, y)`.
 */
import type { Point } from "#board/layout.ts";

export type Camera = { scale: number; x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

const FIT_PAD = 8;
/** Zoom limits relative to the fitted scale; the upper one never below `MIN_MAX_SCALE`. */
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 2;
const MIN_MAX_SCALE = 1;

const clamp = (value: number, centre: number, reach: number) =>
  Math.min(centre + reach, Math.max(centre - reach, value));

/** The camera that shows `bounds` whole, centred in `area`. */
export function fitCamera(bounds: Rect, area: Rect): Camera {
  const scale = Math.max(
    0.01,
    Math.min((area.w - 2 * FIT_PAD) / bounds.w, (area.h - 2 * FIT_PAD) / bounds.h),
  );
  return {
    scale,
    x: area.x + area.w / 2 - (bounds.x + bounds.w / 2) * scale,
    y: area.y + area.h / 2 - (bounds.y + bounds.h / 2) * scale,
  };
}

export const scaleLimits = (fit: Camera) => ({
  min: fit.scale * MIN_ZOOM,
  max: Math.max(MIN_MAX_SCALE, fit.scale * MAX_ZOOM),
});

/** Zooms to `scale`, keeping the Board point under screen point `anchor` in place. */
export function zoomAround(camera: Camera, anchor: Point, scale: number): Camera {
  const bx = (anchor.x - camera.x) / camera.scale;
  const by = (anchor.y - camera.y) / camera.scale;
  return { scale, x: anchor.x - bx * scale, y: anchor.y - by * scale };
}

/** A pointer gesture in canvas CSS px: the midpoint between the fingers and their distance. */
export type GestureSpan = { mid: Point; spread: number };

/**
 * One move of a pointer gesture: zooms by `to.spread / from.spread` (a
 * one-finger span has 0 spread, so it only pans) and pans so the Board point
 * under `from.mid` lands under `to.mid`. The scale stays within `limits`; the
 * Board still clamps the camera's position in its `move`.
 */
export function gestureCamera(
  camera: Camera,
  from: GestureSpan,
  to: GestureSpan,
  limits: { min: number; max: number },
): Camera {
  const ratio = from.spread > 0 ? to.spread / from.spread : 1;
  const scale = Math.min(limits.max, Math.max(limits.min, camera.scale * ratio));
  const zoomed = zoomAround(camera, from.mid, scale);
  return {
    scale,
    x: zoomed.x + to.mid.x - from.mid.x,
    y: zoomed.y + to.mid.y - from.mid.y,
  };
}

/**
 * Keeps the zoom within limits and the Board within reach: any Board edge can
 * be dragged as far as the middle of the fit area, never further.
 */
export function clampCamera(camera: Camera, fit: Camera, bounds: Rect, area: Rect): Camera {
  const { min, max } = scaleLimits(fit);
  const scale = Math.min(max, Math.max(min, camera.scale));
  const anchored = scale === camera.scale ? camera : zoomAround(camera, centreOf(area), scale);
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  // The Board's centre, in Board units.
  const bx = bounds.x + bounds.w / 2;
  const by = bounds.y + bounds.h / 2;
  const reachX = Math.max((bounds.w * scale) / 2, area.w / 4);
  const reachY = Math.max((bounds.h * scale) / 2, area.h / 4);
  return {
    scale,
    x: clamp(anchored.x, cx - bx * scale, reachX),
    y: clamp(anchored.y, cy - by * scale, reachY),
  };
}

export const centreOf = (area: Rect): Point => ({ x: area.x + area.w / 2, y: area.y + area.h / 2 });

export const toScreen = (camera: Camera, point: Point): Point => ({
  x: point.x * camera.scale + camera.x,
  y: point.y * camera.scale + camera.y,
});

export const sameCamera = (a: Camera, b: Camera) =>
  a.scale === b.scale && a.x === b.x && a.y === b.y;
