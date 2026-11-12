import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPwa, ICONS, manifestFor, themeTokens } from "../scripts/pwa.ts";

// The install surface (spec: Mobile polish and installable PWA): the manifest
// and the icons are built from the theme and the logo, so the tests read the
// same files the build reads — `styles.css` for the colours, the logo for the
// pixels — and check the built output, not the source text.

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const light = themeTokens(css);
const dark = themeTokens(css, "dark");

describe("themeTokens", () => {
  it("reads the light theme's background and primary tokens", () => {
    expect(light).toEqual({ background: "#ffe8cc", primary: "#ff7a1a" });
  });

  it("reads the dark theme's background and primary tokens", () => {
    expect(dark).toEqual({ background: "#262335", primary: "#ff9f43" });
  });
});

describe("manifestFor", () => {
  const manifest = manifestFor(light);

  it("installs the game as its own standalone app at the root", () => {
    expect(manifest).toMatchObject({
      id: "/",
      name: "UNIversum",
      short_name: "UNIversum",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("takes its theme and background colours from the theme", () => {
    expect(manifest.theme_color).toBe(light.primary);
    expect(manifest.background_color).toBe(light.background);
  });

  it("lists a 192 and a 512 icon and a 512 maskable icon", () => {
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });
});

describe("buildPwa", () => {
  const out = mkdtempSync(join(tmpdir(), "universum-pwa-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  beforeAll(async () => {
    await buildPwa({ output: out });
  }, 60_000);

  it("writes a manifest whose icons exist and really are their listed sizes", async () => {
    const manifest = JSON.parse(readFileSync(join(out, "manifest.webmanifest"), "utf8"));
    expect(manifest).toEqual(manifestFor(light));

    await Promise.all(
      ICONS.map(async (icon) => {
        const { width, height } = await sharp(join(out, "icons", icon.file)).metadata();
        expect({ file: icon.file, width, height }).toEqual({
          file: icon.file,
          width: icon.size,
          height: icon.size,
        });
      }),
    );
  });

  it("paints the icons on the theme's background with the logo inside a safe margin", async () => {
    const expected = sharp({
      create: { width: 1, height: 1, channels: 4, background: light.background },
    });
    const plate = await expected.raw().toBuffer();

    await Promise.all(
      ICONS.map(async (icon) => {
        const file = join(out, "icons", icon.file);
        const stats = await sharp(file).stats();
        expect(stats.channels[3]?.min).toBe(255);

        const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
        // The padding above the (wide) logo is background, not a black plate.
        const samples = [
          [0, 0],
          [icon.size - 1, 0],
          [0, icon.size - 1],
          [icon.size - 1, icon.size - 1],
          [Math.floor(icon.size / 2), Math.floor(icon.size * icon.padding + 1)],
        ] as const;
        for (const [x, y] of samples) {
          const start = (y * icon.size + x) * 4;
          expect([...data.subarray(start, start + 4)]).toEqual([...plate]);
        }

        const { info } = await sharp(file)
          .trim({ background: light.background, threshold: 12 })
          .toBuffer({ resolveWithObject: true });
        const margin = icon.size * icon.padding;
        expect(info.width).toBeLessThanOrEqual(icon.size - 2 * margin);
        expect(info.height).toBeLessThanOrEqual(icon.size - 2 * margin);
        expect(Math.abs(info.trimOffsetLeft!)).toBeGreaterThanOrEqual(margin);
        expect(Math.abs(info.trimOffsetTop!)).toBeGreaterThanOrEqual(margin);
      }),
    );
  });
});

describe("the app shell's install tags", () => {
  it("links the manifest", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it("gives the browser the theme colour for both schemes", () => {
    const metas = [
      ...html.matchAll(
        /<meta name="theme-color" content="([^"]+)" media="\(prefers-color-scheme: (\w+)\)" \/>/g,
      ),
    ];
    expect(metas.map(([, content, scheme]) => [scheme, content])).toEqual([
      ["light", light.primary],
      ["dark", dark.primary],
    ]);
  });

  it("points iOS at the 180px touch icon", () => {
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />',
    );
  });
});
