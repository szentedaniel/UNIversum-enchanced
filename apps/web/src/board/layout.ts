/**
 * Isometric placement as plain math: Field index → ring cell → 2:1 diamond
 * coordinates. The ring is the edge of a 9 × 9 grid of cells with Start at the
 * front corner, Fields 1–8 running up-left to Quarantine, 9–16 up-right to the
 * Doubler, 17–24 down-right to Erasmus and 25–31 back to Start (v1's layout).
 *
 * Units are the v1 art's pixels ("Board units"): one ground tile is a 2:1
 * diamond `TILE_W` wide. A corner cell is 3 × 3 tiles, every other cell 2
 * tiles along the edge and 3 deep, with a small gap between cells, as in v1.
 */
import { FIELD_COUNT, type FieldId } from "@universum/rules/board";

/** Half a tile's width and height: the step of one tile along a grid axis (v1's art). */
export const TILE_HALF_W = 129 / 2;
export const TILE_HALF_H = 32;
export const TILE_W = 2 * TILE_HALF_W;
/** A normal Field's width on the Board, the yardstick for tap radii. */
export const FIELD_WIDTH = TILE_W;

const SIDE = 8;
const CORNER_TILES = 3;
const FIELD_TILES = 2;
/** Gap between neighbouring cells, in tiles (v1's 5 px at its 0.65 scale). */
const GAP = 0.1;

export type Cell = { col: number; row: number };
export type Point = { x: number; y: number };

export function fieldToCell(id: FieldId): Cell {
  const i = ((id % FIELD_COUNT) + FIELD_COUNT) % FIELD_COUNT;
  if (i <= SIDE) return { col: SIDE - i, row: SIDE };
  if (i <= 2 * SIDE) return { col: 0, row: 2 * SIDE - i };
  if (i <= 3 * SIDE) return { col: i - 2 * SIDE, row: 0 };
  return { col: SIDE, row: i - 3 * SIDE };
}

const isEdge = (index: number) => index === 0 || index === SIDE;

export const isCornerCell = ({ col, row }: Cell): boolean => isEdge(col) && isEdge(row);

/**
 * Whether the Field's art is mirrored. v1 mirrors the Fields on the edges
 * that run along the row axis (9–15 and 25–31), so every label faces the viewer.
 */
export const isMirrored = (cell: Cell): boolean => !isCornerCell(cell) && isEdge(cell.col);

/** The centre of cell `index` along one grid axis, in tiles from the ring's outer edge. */
function axisCentre(index: number): number {
  if (index === 0) return CORNER_TILES / 2;
  const first = CORNER_TILES + GAP + FIELD_TILES / 2;
  if (index < SIDE) return first + (index - 1) * (FIELD_TILES + GAP);
  return first + (SIDE - 2) * (FIELD_TILES + GAP) + FIELD_TILES / 2 + GAP + CORNER_TILES / 2;
}

const RING_CENTRE = (axisCentre(0) + axisCentre(SIDE)) / 2;

/** Grid position (in tiles, either axis) → Board point; the ring's centre is (0, 0). */
export function gridToPoint(col: number, row: number): Point {
  const gx = col - RING_CENTRE;
  const gy = row - RING_CENTRE;
  return { x: (gx - gy) * TILE_HALF_W, y: (gx + gy) * TILE_HALF_H };
}

/** The centre of a cell's top face. Larger `y` is nearer the viewer. */
export const cellToPoint = ({ col, row }: Cell): Point =>
  gridToPoint(axisCentre(col), axisCentre(row));

export const fieldPoint = (id: FieldId): Point => cellToPoint(fieldToCell(id));
