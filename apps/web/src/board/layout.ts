/**
 * Isometric placement as plain math: Field index → ring cell → 2:1 diamond
 * coordinates. The ring is the edge of a 9 × 9 grid with Start at the front
 * corner, Fields 1–8 running up-left to Quarantine, 9–16 up-right to the
 * Doubler, 17–24 down-right to Erasmus and 25–31 back to Start (v1's layout).
 */
import { FIELD_COUNT, type FieldId } from "@universum/rules/board";

/** Width and height of one Field's diamond, in Board units (2:1). */
export const TILE_W = 96;
export const TILE_H = TILE_W / 2;

const SIDE = 8;

export type Cell = { col: number; row: number };
export type Point = { x: number; y: number };

export function fieldToCell(id: FieldId): Cell {
  const i = ((id % FIELD_COUNT) + FIELD_COUNT) % FIELD_COUNT;
  if (i <= SIDE) return { col: SIDE - i, row: SIDE };
  if (i <= 2 * SIDE) return { col: 0, row: 2 * SIDE - i };
  if (i <= 3 * SIDE) return { col: i - 2 * SIDE, row: 0 };
  return { col: SIDE, row: i - 3 * SIDE };
}

/** The centre of a cell's diamond. Larger `y` is nearer the viewer. */
export function cellToPoint({ col, row }: Cell): Point {
  return { x: ((col - row) * TILE_W) / 2, y: ((col + row) * TILE_H) / 2 };
}

export const fieldPoint = (id: FieldId): Point => cellToPoint(fieldToCell(id));

/** The diamond's corners around its centre (top, right, bottom, left). */
export function diamond({ x, y }: Point, inset = 0): number[] {
  const w = TILE_W / 2 - inset;
  const h = TILE_H / 2 - inset / 2;
  return [x, y - h, x + w, y, x, y + h, x - w, y];
}
