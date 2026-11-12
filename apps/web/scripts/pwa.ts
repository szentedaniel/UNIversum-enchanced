import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Builds the install surface (spec: Mobile polish and installable PWA): the
 * web app manifest and the icons, from the theme tokens and `assets/logo.png`.
 * Vite serves the output from `public/`, so `/manifest.webmanifest` and
 * `/icons/*` are stable URLs; Caddy gives them their own cache headers.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
/** Where the build writes the manifest and `icons/`; gitignored. */
export const PWA_OUTPUT = join(webRoot, "public");
const LOGO = join(webRoot, "assets/logo.png");
const STYLES = join(webRoot, "src/styles.css");

export type Scheme = "light" | "dark";

/** The two theme tokens the manifest and the browser chrome use. */
export type ThemeColours = {
  /** `--background`: the install splash and the icon plate. */
  background: string;
  /** `--primary`: the browser chrome's theme colour. */
  primary: string;
};

/** The body of the first `:root` block matching `opener`. */
function block(css: string, opener: RegExp): string {
  const start = css.search(opener);
  if (start < 0) throw new Error(`no theme block matching ${opener}`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`no --${name} token in the theme`);
  return match[1].trim();
}

/**
 * Reads the colours from `styles.css`: light from `:root`, dark from the
 * `prefers-color-scheme: dark` block. The manifest uses light (its one
 * `theme_color` cannot follow the OS), and the head tags offer both.
 */
export function themeTokens(css: string, scheme: Scheme = "light"): ThemeColours {
  const body = block(
    css,
    scheme === "dark" ? /@media \(prefers-color-scheme: dark\)/ : /^:root\s*\{/m,
  );
  return { background: token(body, "background"), primary: token(body, "primary") };
}

export type ManifestIcon = {
  src: string;
  sizes: `${number}x${number}`;
  type: "image/png";
  purpose: "any" | "maskable";
};

export type WebAppManifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

export type IconSpec = {
  file: string;
  size: number;
  purpose: "any" | "maskable";
  /** Fraction of the icon left empty on each side before the logo. */
  padding: number;
  /** Whether the manifest lists it; iOS reads the touch icon by itself. */
  manifest: boolean;
};

/**
 * The logo is a wide banner (1600 × 1067 with a 1186 × 317 content box), so
 * every icon pads it instead of cropping or stretching it. The maskable one
 * leaves the central 60% for the logo, inside Android's 80% safe circle.
 */
export const ICONS: readonly IconSpec[] = [
  { file: "icon-192.png", size: 192, purpose: "any", padding: 0.08, manifest: true },
  { file: "icon-512.png", size: 512, purpose: "any", padding: 0.08, manifest: true },
  {
    file: "icon-maskable-512.png",
    size: 512,
    purpose: "maskable",
    padding: 0.2,
    manifest: true,
  },
  { file: "apple-touch-icon.png", size: 180, purpose: "any", padding: 0.08, manifest: false },
];

export function manifestFor(theme: ThemeColours): WebAppManifest {
  return {
    id: "/",
    name: "UNIversum",
    short_name: "UNIversum",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: theme.background,
    theme_color: theme.primary,
    icons: ICONS.filter((icon) => icon.manifest).map((icon) => ({
      src: `/icons/${icon.file}`,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.purpose,
    })),
  };
}

/**
 * Draws one icon: trims the logo's transparent border, scales it inside the
 * padded square and centres it on an opaque `background` plate. Padding uses
 * whole pixels so a rounded corner can never cut into the art.
 */
export async function renderIcon(
  logo: string | Buffer,
  icon: IconSpec,
  background: string,
): Promise<Buffer> {
  const margin = Math.ceil(icon.size * icon.padding);
  const inner = icon.size - 2 * margin;
  const art = await sharp(logo)
    .trim()
    .resize({ width: inner, height: inner, fit: "inside" })
    .png()
    .toBuffer();
  return sharp({ create: { width: icon.size, height: icon.size, channels: 4, background } })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toBuffer();
}

export type BuildPwaOptions = {
  /** Default `public/`. */
  output?: string;
  /** Default `assets/logo.png`. */
  logo?: string;
  /** Default `src/styles.css`. */
  styles?: string;
};

/** Writes the manifest and every icon into `output`. */
export async function buildPwa({
  output = PWA_OUTPUT,
  logo = LOGO,
  styles = STYLES,
}: BuildPwaOptions = {}): Promise<void> {
  const theme = themeTokens(await readFile(styles, "utf8"));
  const icons = join(output, "icons");
  await mkdir(icons, { recursive: true });
  await Promise.all([
    ...ICONS.map(async (icon) => {
      const png = await renderIcon(logo, icon, theme.background);
      await writeFile(join(icons, icon.file), png);
    }),
    writeFile(
      join(output, "manifest.webmanifest"),
      `${JSON.stringify(manifestFor(theme), null, 2)}\n`,
    ),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPwa();
