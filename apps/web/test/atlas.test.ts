import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAtlas, recolour } from "../scripts/atlas.ts";

// The Board atlas is built from the uncoloured v1 art. Group and owner colours
// are baked into extra frames at build time (no runtime filters), with the same
// maths as v1's ColorReplaceFilter: a pixel within `tolerance` of the original
// colour becomes the target colour, keeping its offset from the original.

const pixel = (rgba: number[]) => Uint8Array.from(rgba);

describe("recolour", () => {
  it("turns the original colour into the target colour", () => {
    const image = pixel([0xc2, 0xbe, 0xac, 255]);
    recolour(image, 0xc2beac, 0x915537, 0.095);
    expect([...image]).toEqual([0x91, 0x55, 0x37, 255]);
  });

  it("keeps a nearby shade's offset from the original, like v1's filter", () => {
    // 10 below the original in every channel: (original − pixel) is added to the target.
    const image = pixel([0xb8, 0xb4, 0xa2, 255]);
    recolour(image, 0xc2beac, 0x915537, 0.095);
    expect([...image]).toEqual([0x9b, 0x5f, 0x41, 255]);
  });

  it("leaves colours outside the tolerance and transparent pixels alone", () => {
    const image = pixel([0x97, 0x93, 0x85, 255, 0xc2, 0xbe, 0xac, 0]);
    recolour(image, 0xc2beac, 0x915537, 0.095);
    expect([...image]).toEqual([0x97, 0x93, 0x85, 255, 0xc2, 0xbe, 0xac, 0]);
  });

  it("clamps channels that would leave 0–255", () => {
    const image = pixel([0x00, 0x00, 0x00, 255]);
    recolour(image, 0x202020, 0xf0f0f0, 1);
    expect([...image]).toEqual([255, 255, 255, 255]);
  });
});

type Sheet = { frames: Record<string, unknown>; meta: { scale: number | string } };
type Manifest = { bundles: { name: string; assets: { alias: string[]; src: string[] }[] }[] };

describe("buildAtlas", () => {
  const out = mkdtempSync(join(tmpdir(), "universum-atlas-"));
  let manifest: Manifest;
  const sheets: Sheet[] = [];

  beforeAll(async () => {
    await buildAtlas({ output: out, cache: false });
    manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    const board = manifest.bundles.flatMap((b) => b.assets).find((a) => a.alias.includes("board"));
    for (const src of board?.src ?? []) {
      if (src.endsWith(".json")) sheets.push(JSON.parse(readFileSync(join(out, src), "utf8")));
    }
  }, 120_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("packs the Board into one atlas at full and half resolution", () => {
    const scales = sheets.map((s) => Number(s.meta.scale)).toSorted((a, b) => a - b);
    expect(scales).toEqual([0.5, 1]);
  });

  it("has a pre-coloured label frame per Group and house frames per Seat", () => {
    const frames = Object.keys(sheets[0]?.frames ?? {});
    for (const group of [1, 2, 3, 4, 5, 6, 7, 8]) expect(frames).toContain(`label_g${group}`);
    for (const seat of [0, 1, 2, 3]) {
      expect(frames).toContain(`house_base_p${seat}`);
      expect(frames).toContain(`house_storey_p${seat}`);
      expect(frames).toContain(`house_roof_p${seat}`);
      expect(frames).toContain(`museum_p${seat}`);
      expect(frames).toContain(`alien_p${seat}`);
    }
    for (const name of ["label", "ground", "road", "museum", "doubler", "chest_n", "tax"]) {
      expect(frames).toContain(name);
    }
  });
});
