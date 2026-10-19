/**
 * Builds the Board atlas: one AssetPack spritesheet at full and half
 * resolution, from the uncoloured v1 art in `assets/images`.
 *
 * Group and owner colours are baked into extra frames here, at build time,
 * with v1's ColorReplaceFilter maths, so the Board needs no runtime filters.
 * The generated frames are never committed: they go to a staging folder, and
 * AssetPack writes the atlas and its manifest to `public/atlas` (gitignored).
 *
 * Run by the Vite plugin in vite.config.ts (dev and build), or by hand with
 * `pnpm --filter @universum/web run atlas`.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetPack } from "@assetpack/core";
import { pixiPipes } from "@assetpack/core/pixi";
import sharp from "sharp";
import { GROUP_COLORS, PLAYER_COLORS } from "../src/board/colors.ts";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const images = join(webRoot, "assets/images");

/** Where the atlas lands: served by Vite as `/atlas/…`. */
export const ATLAS_OUTPUT = join(webRoot, "public/atlas");
/** The AssetPack bundle (and spritesheet alias) the Board loads. */
export const ATLAS_BUNDLE = "board";

const clamp = (value: number) => Math.max(0, Math.min(255, value));

const channels = (color: number) => [(color >> 16) & 255, (color >> 8) & 255, color & 255] as const;

/**
 * v1's ColorReplaceFilter on an RGBA buffer, in place: a pixel within
 * `tolerance` (RGB distance, channels 0–1) of `from` becomes `to` plus the
 * pixel's offset from `from`, so shading survives. Transparent pixels stay.
 */
export function recolour(rgba: Uint8Array, from: number, to: number, tolerance: number): void {
  const [fr, fg, fb] = channels(from);
  const [tr, tg, tb] = channels(to);
  const limit = (tolerance * 255) ** 2;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const dr = fr - (rgba[i] ?? 0);
    const dg = fg - (rgba[i + 1] ?? 0);
    const db = fb - (rgba[i + 2] ?? 0);
    if (dr * dr + dg * dg + db * db > limit) continue;
    rgba[i] = clamp(tr + dr);
    rgba[i + 1] = clamp(tg + dg);
    rgba[i + 2] = clamp(tb + db);
  }
}

type Recolour = { from: number; tolerance: number; to: Record<string, number> };

type Source = {
  /** Under `assets/images`. */
  file: string;
  /** Longest side in px; larger art is scaled down (the Board sizes sprites itself). */
  maxSize?: number;
  /** Writes the uncoloured frame too (default true). */
  plain?: boolean;
  /** Extra frames `<name>_<suffix>`, one per target colour. */
  recolour?: Recolour;
};

const byGroup: Record<string, number> = Object.fromEntries(
  Object.entries(GROUP_COLORS).map(([group, color]) => [`g${group}`, color]),
);
const bySeat: Record<string, number> = Object.fromEntries(
  PLAYER_COLORS.map((color, seat) => [`p${seat}`, color]),
);

/** Frame name → source. Colours and tolerances are v1's (Normal/Museum/Building components). */
const SOURCES: Record<string, Source> = {
  label: {
    file: "isometriccity/PNG/cityTiles_072.png",
    recolour: { from: 0xc2beac, tolerance: 0.095, to: byGroup },
  },
  ground: { file: "isometriclandscape/PNG/landscapeTiles_067.png" },
  road: { file: "isometriclandscape/PNG/landscapeTiles_081_1.png" },
  road_left: { file: "isometriclandscape/PNG/landscapeTiles_087.png" },
  road_right: { file: "isometriclandscape/PNG/landscapeTiles_080.png" },
  road_top: { file: "isometriclandscape/PNG/landscapeTiles_114.png" },
  house_base: {
    file: "characters/haz_alap.png",
    plain: false,
    recolour: { from: 0xd8d2be, tolerance: 1, to: bySeat },
  },
  house_storey: {
    file: "characters/haz_resz.png",
    plain: false,
    recolour: { from: 0xd8d2be, tolerance: 1, to: bySeat },
  },
  house_roof: {
    file: "characters/haz_teto.png",
    plain: false,
    recolour: { from: 0xd8d2be, tolerance: 1, to: bySeat },
  },
  museum: {
    file: "characters/museum.png",
    maxSize: 320,
    recolour: { from: 0xc2bea8, tolerance: 0.05, to: bySeat },
  },
  doubler: { file: "characters/doubler.png" },
  quarantine: { file: "characters/karibacsik.png", maxSize: 384 },
  erasmus: { file: "characters/erasmus.png", maxSize: 384 },
  diploma: { file: "characters/diploma.png", maxSize: 384 },
  start_sign: { file: "characters/tabla.png" },
  chest_e: { file: "characters/chest_E.png" },
  chest_n: { file: "characters/chest_N.png" },
  tax: { file: "characters/ado2.png", maxSize: 256 },
  alien_p0: { file: "moreenemiesanimations/Alien sprites/alienPink.png" },
  alien_p1: { file: "moreenemiesanimations/Alien sprites/alienBlue.png" },
  alien_p2: { file: "moreenemiesanimations/Alien sprites/alienGreen.png" },
  alien_p3: { file: "moreenemiesanimations/Alien sprites/alienYellow.png" },
};

/** Writes every frame (plain and recoloured) as a PNG into `dir`. */
async function stageFrames(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Object.entries(SOURCES).map(async ([name, source]) => {
      let image = sharp(join(images, source.file)).ensureAlpha();
      if (source.maxSize) {
        image = image.resize(source.maxSize, source.maxSize, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const raw = { width: info.width, height: info.height, channels: 4 } as const;
      const write = (frame: string, pixels: Uint8Array) =>
        sharp(pixels, { raw })
          .png()
          .toFile(join(dir, `${frame}.png`));
      const writes = [];
      if (source.plain !== false) writes.push(write(name, data));
      const { recolour: variants } = source;
      for (const [suffix, color] of Object.entries(variants?.to ?? {})) {
        const pixels = Uint8Array.from(data);
        recolour(pixels, variants!.from, color, variants!.tolerance);
        writes.push(write(`${name}_${suffix}`, pixels));
      }
      await Promise.all(writes);
    }),
  );
}

export type BuildAtlasOptions = {
  /** Default `public/atlas`. */
  output?: string;
  /** AssetPack's cache (skips unchanged work); default true. */
  cache?: boolean;
};

/** Stages the frames and packs them into the `board` spritesheet (1× and 0.5×). */
export async function buildAtlas({
  output = ATLAS_OUTPUT,
  cache = true,
}: BuildAtlasOptions = {}): Promise<void> {
  const staging = join(webRoot, "node_modules/.cache/universum-atlas", cache ? "keep" : "once");
  const entry = join(staging, "raw");
  await rm(entry, { recursive: true, force: true });
  await stageFrames(join(entry, `${ATLAS_BUNDLE}{m}`, `${ATLAS_BUNDLE}{tps}`));
  const pack = new AssetPack({
    entry,
    output,
    cache,
    cacheLocation: join(staging, ".assetpack"),
    logLevel: "warn",
    pipes: pixiPipes({
      cacheBust: false,
      resolutions: { default: 1, low: 0.5 },
      compression: { png: true, webp: false, jpg: false },
      texturePacker: { texturePacker: { nameStyle: "short", removeFileExtension: true } },
      manifest: { output: "manifest.json", createShortcuts: true, trimExtensions: true },
    }),
  });
  await pack.run();
  if (!cache) await rm(staging, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildAtlas();
