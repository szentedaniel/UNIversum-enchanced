/**
 * The Board's art: each Field rebuilt from v1's sprite stacks (Normal, Museum,
 * Chance, Tax and Corner components), drawn from the one atlas. Group and
 * owner colours are pre-coloured atlas frames (`label_g3`, `house_base_p1`, …);
 * nothing here uses a filter.
 *
 * Positions inside a Field are v1's, in Board units, relative to the stack's
 * own origin; `placeField` then centres the stack's top face on its ring cell.
 */
import type { FieldInfo } from "@universum/rules/board";
import { Container, Graphics, Sprite, Text, type TextStyleOptions, type Texture } from "pixi.js";
import { fieldToCell, isCornerCell, isMirrored, type Point } from "#board/layout.ts";

/** v1's stack geometry: tile half-height, bottom height, half-width. */
const H = 96 / 2;
const B = 32;
const W = 129 / 2;
/** A tile sprite is 132 × 99; its top face is the upper 66 px, centred 16.5 px above the sprite's centre. */
const FACE_DY = 16.5;
const FACE = [
  [0, -49.5],
  [66, -16.5],
  [0, 16.5],
  [-66, -16.5],
] as const;

const LABEL_STYLE: TextStyleOptions = {
  align: "center",
  fontFamily: "Arial, Helvetica, sans-serif",
  fill: "#000000",
  fontSize: 22,
  fontWeight: "bold",
  stroke: { color: "#eeeeee", width: 4, join: "round" },
  wordWrap: true,
  wordWrapWidth: 150,
  lineHeight: 30,
};
const NOTE_STYLE: TextStyleOptions = { ...LABEL_STYLE, fontSize: 45 };
const CORNER_STYLE: TextStyleOptions = {
  align: "center",
  fontFamily: "Arial, Helvetica, sans-serif",
  fill: "#ffffff",
  fontSize: 40,
  fontWeight: "bold",
  stroke: { color: "#555555", width: 10, join: "round" },
  wordWrap: true,
  wordWrapWidth: 200,
  dropShadow: { alpha: 0.8, angle: 2.1, blur: 2, color: "#111111", distance: 6 },
};

/** Looks up an atlas frame by name (see scripts/atlas.ts). */
export type Frames = (name: string) => Texture;

/** What a Field shows that changes during the game. */
export type FieldLook = {
  /** The owner's Seat, or `null`. */
  ownerSeat: number | null;
  level: number;
  hasDoubler: boolean;
  /** Compact money on the tile (Rent), or `null`. */
  note: string | null;
};

export type FieldArt = {
  readonly container: Container;
  /** The top face's centre, in the stack's local units. */
  readonly centre: Point;
  /** Convex outline of the top faces, local units, flat `[x, y, …]`. */
  readonly outline: number[];
  /** Every canvas text, so the Board can re-rasterise them at the zoom level. */
  readonly texts: Text[];
  setLook(look: FieldLook): void;
  /** The selection ring, `width` in local units (the Board keeps it ~3 screen px). */
  setRing(ring: { color: number; width: number } | null): void;
};

type Pair = [number, number];

const cross = (o: Pair, a: Pair, b: Pair) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** One half of the monotone-chain hull. */
function halfHull(list: Pair[]): Pair[] {
  const out: Pair[] = [];
  for (const p of list) {
    while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
    out.push(p);
  }
  return out.slice(0, -1);
}

function hull(points: Pair[]): Pair[] {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [...halfHull(sorted), ...halfHull(sorted.toReversed())];
}

/** v1's tilted tile text: rotated, stretched and skewed onto the tile. */
function tiltedText(text: string, style: TextStyleOptions, at: Point, mirrored: boolean) {
  const wrap = new Container({ zIndex: 90, x: at.x, y: at.y, rotation: Math.PI / 6.66667 });
  wrap.scale.set(1, 1.2);
  const label = new Text({ text, style, anchor: 0.5 });
  label.skew.set(-Math.PI / 4, 0);
  label.scale.set(mirrored ? -1 : 1, 1);
  wrap.addChild(label);
  return { wrap, label };
}

/** A sprite `width` Board units wide (negative mirrors it), whatever the frame's resolution. */
function sized(texture: Texture, width: number, at: Point, zIndex: number): Sprite {
  const sprite = new Sprite({ texture, anchor: 0.5, x: at.x, y: at.y, zIndex });
  const scale = width / texture.width;
  sprite.scale.set(scale, Math.abs(scale));
  return sprite;
}

export function createFieldArt(field: FieldInfo, label: string, frames: Frames): FieldArt {
  const cell = fieldToCell(field.id);
  const corner = isCornerCell(cell);
  const mirrored = isMirrored(cell);
  const container = new Container({ sortableChildren: true });
  container.scale.set(mirrored ? -1 : 1, 1);
  const tiles: Point[] = [];
  const texts: Text[] = [];
  const tile = (frame: string, x: number, y: number, zIndex: number) => {
    container.addChild(new Sprite({ texture: frames(frame), anchor: 0.5, x, y, zIndex }));
    tiles.push({ x, y });
  };

  if (corner) {
    const start = field.kind === "start";
    const edge = start ? "label" : "road";
    tile(edge, -W, H, 2);
    tile(edge, -W * 2, -B + H, 1);
    tile(edge, 0, B + H, 3);
    tile(edge, W, H, 2);
    tile(edge, W * 2, -B + H, 1);
    tile("road", 0, -B + H, 0);
    tile(start ? "road_left" : "road", -W, -B * 2 + H, -1);
    tile(start ? "road_top" : "road", 0, -B * 3 + H, -2);
    tile(start ? "road_right" : "road", W, -B * 2 + H, -1);
    const feature = (frame: string, width: number, at: Point) =>
      container.addChild(sized(frames(frame), width, at, 3));
    if (field.kind === "quarantine")
      feature("quarantine", 959 * 0.2, { x: -W * 1.25, y: -H * 1.25 });
    if (field.kind === "erasmus") feature("erasmus", -487 * 0.5, { x: 0, y: -B / 2 });
    if (field.kind === "doubler") feature("diploma", 571 * 0.5, { x: 0, y: -B - 20 });
    if (field.kind === "start") feature("start_sign", 71, { x: 0, y: -B - H * 1.6 });
    if (!start) {
      const text = new Text({ text: label, style: CORNER_STYLE, anchor: 0.5, zIndex: 90 });
      texts.push(text);
      container.addChild(text);
    }
  } else {
    // Museums are paved with label tiles; the others have a label strip and ground.
    const front = field.group ? `label_g${field.group}` : "label";
    const back = field.kind === "museum" ? "label" : "ground";
    tile(front, -W, H + H / 2, 2);
    tile(front, -W * 2 + 1, -B + H + H / 2, 1);
    tile(back, 0, -B + H + H / 2, 0);
    tile(back, -W, -B * 2 + H + H / 2, -1);
    tile(back, 0, -B * 3 + H + H / 2, -2);
    tile(back, W, -B * 2 + H + H / 2, -1);
    const long = label.includes(" ") && label.length > 9;
    const name = tiltedText(
      label.toUpperCase(),
      LABEL_STYLE,
      long ? { x: -33, y: 7 } : { x: -50, y: 14 },
      mirrored,
    );
    texts.push(name.label);
    container.addChild(name.wrap);
    if (field.kind === "chance") {
      const chest = sized(
        frames(mirrored ? "chest_e" : "chest_n"),
        136 * 0.7,
        { x: W / 6, y: -H * 0.8 },
        10,
      );
      chest.scale.x *= mirrored ? 1 : -1;
      container.addChild(chest);
    }
    if (field.kind === "tax") {
      container.addChild(sized(frames("tax"), -265 * 0.5, { x: W / 6, y: -H * 0.6 }, 10));
    }
  }

  // The outline: the hull of every tile's top face.
  const points: [number, number][] = [];
  for (const { x, y } of tiles) for (const [dx, dy] of FACE) points.push([x + dx, y + dy]);
  const outline = hull(points).flat();
  const centre = {
    x: tiles.reduce((sum, t) => sum + t.x, 0) / tiles.length,
    y: tiles.reduce((sum, t) => sum + t.y, 0) / tiles.length - FACE_DY,
  };

  const ring = new Graphics({ zIndex: 95, visible: false });
  container.addChild(ring);

  // Parts that follow the view: the building, the Museum, the Doubler token and the tile note.
  let parts: Container[] = [];
  let note: Text | null = null;
  let shown = "";
  const add = (part: Container) => {
    parts.push(part);
    container.addChild(part);
  };

  function setLook(look: FieldLook): void {
    const key = JSON.stringify(look);
    if (key === shown) return;
    shown = key;
    for (const part of parts) part.destroy({ children: true });
    parts = [];
    if (note) texts.splice(texts.indexOf(note), 1);
    note = null;
    const { ownerSeat, level, hasDoubler } = look;
    if (field.kind === "university" && ownerSeat !== null && level > 0) {
      const building = new Container({ x: W / 4, y: -B, zIndex: 10 });
      const floor = (part: string, y: number) => {
        const sprite = new Sprite({ texture: frames(`${part}_p${ownerSeat}`), anchor: 0.5, y });
        sprite.scale.x = -1; // v1 mirrors every house part
        building.addChild(sprite);
      };
      for (let i = 0; i < level; i++)
        floor(i === 0 ? "house_base" : "house_storey", -32 * i - (i === 0 ? 1 : 0));
      floor("house_roof", -32 * level + 16);
      add(building);
    }
    if (field.kind === "museum") {
      const frame = ownerSeat === null ? "museum" : `museum_p${ownerSeat}`;
      add(sized(frames(frame), 1042 * 0.26, { x: W / 3, y: -H * 1.27 }, 3));
    }
    if (hasDoubler) {
      add(sized(frames("doubler"), 141 * 0.93, { x: W, y: -B * 5 }, -5));
    }
    if (look.note !== null && !corner) {
      const text = tiltedText(look.note, NOTE_STYLE, { x: -105, y: 43 }, mirrored);
      note = text.label;
      texts.push(note);
      add(text.wrap);
    }
  }

  return {
    container,
    centre,
    outline,
    texts,
    setLook,
    setRing(next) {
      ring.visible = next !== null;
      ring.clear();
      if (next) {
        ring
          .poly(outline)
          .fill({ color: 0xffffff, alpha: 0.3 })
          .stroke({ ...next, join: "round" });
      }
    },
  };
}
