# Ticket #259 (PWA manifest, icons, head tags, Caddy headers) — facts for later tickets

Branch `agent/issue-259-pwa-manifest-generated-icons-head-tags-and-caddy-h`. Files: `apps/web/scripts/pwa.ts`,
`apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/test/pwa.test.ts`, root `Caddyfile`, `README.md`,
`.gitignore`. Spec #184's service-worker and update-flow tickets build on this surface.

## The install surface

- `apps/web/scripts/pwa.ts` exports `themeTokens(css, scheme)`, `manifestFor(theme)`, `ICONS`, `renderIcon`,
  `buildPwa()` and `PWA_OUTPUT`. `themeTokens` reads the first `:root` block (light) or the
  `@media (prefers-color-scheme: dark)` block from `apps/web/src/styles.css`.
- `manifestFor` uses `--primary` for `theme_color` and `--background` for `background_color`; the manifest is
  light-theme only because it has one `theme_color`, while `index.html` offers a `theme-color` meta per scheme.
- Icons: `icon-192.png` and `icon-512.png` (`any`), `icon-maskable-512.png` (`maskable`), and
  `apple-touch-icon.png` (180, not in the manifest). `icon.size` is a real pixel size; the test measures it.
- `renderIcon` trims the logo, resizes with `fit: "inside"`, then composites it centred on an opaque
  `--background` plate. Do not switch to `fit: "contain"`: in sharp 0.34.5 it fills the canvas with the default
  black background, which is how the first icon build grew black bands.
- The logo is a wide banner (1600 × 1067, content box 1186 × 317), so padding is the only sane square icon:
  regular icons leave 8% per side, the maskable one 20% per side (the logo occupies the central 60% width,
  inside Android's 80% safe circle). A better square source from the owner would only change the logo path or
  these paddings.
- `buildPwa()` writes `apps/web/public/manifest.webmanifest` and `apps/web/public/icons/*`; `.gitignore`
  excludes both (generated, like the atlas). Vite's `pwaAssets()` plugin runs it in `buildStart`, with the same
  `VITEST` skip as `boardAtlas()`.
- `apps/web/index.html` links `/manifest.webmanifest`, sets light/dark `theme-color` metas from `--primary`,
  points at the 192 favicon and 180 apple-touch icon, and sets both standalone launch metas
  (`apple-mobile-web-app-capable`, `mobile-web-app-capable`).

## Caddy

- `Caddyfile` has dedicated `handle` blocks before the SPA catch-all: `/manifest.webmanifest` gets
  `Content-Type: application/manifest+json` and `Cache-Control: no-cache`; `/icons/*` gets
  `Cache-Control: public, max-age=86400`. The icon names are stable, so they are not immutable like hashed
  `/assets/*`; the manifest is revalidated so a name or theme change reaches an installed copy. The `@shell`
  matcher never sees either path.
- A service-worker ticket needs its own `handle` (or matcher) for the worker with `no-cache`, kept out of the
  SPA fallback; the `/colyseus/*`, `/client-config` and `/errors` routes stay uncached by the worker, not Caddy.
- The repo still has no TLS; the README says installs need HTTPS or `localhost`.

## Tests and build

- `apps/web/test/pwa.test.ts` reads `styles.css` and `index.html`, builds into a temp directory, parses the
  manifest and checks the icon files with sharp: exact dimensions, opaque background, no black plate, and the
  padding margins. The head-tag tests compare the `theme-color` metas with the parsed light/dark tokens.
- `TEST_HOOKS=1 pnpm --filter @universum/web run build` copies `public/` into `dist/` (manifest and icons
  included); the plugin is skipped under Vitest so the unit tests build only into their temp directory.
- The old-browser page still hard-codes its dark theme copy (`#262335` / `#fff3e4`) in `index.html`; the
  manifest/head colours come from `styles.css`, not from that block.
