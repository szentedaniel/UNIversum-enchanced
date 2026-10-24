# Prototype branches (throwaway, never merged) — what to reuse

All three branches add one npm/Vite app at `prototypes/board-phone/` and each builds on the previous:
`prototype/board-phone` (#14) ⊂ `prototype/field-selection` (#15) ⊂ `prototype/ui-direction` (#16).
**Use `prototype/ui-direction` for every file** (it's the superset; renderer.ts there has the colour/ring/badge options).
Read a file: `git show prototype/ui-direction:prototypes/board-phone/<path>`.

Pinned versions in its `package.json` (real, installed, Oct 2026): `pixi.js 8.22.0`, `react/react-dom 19.3.1`,
`@types/react 19.3.0`, `vite 8.3.4`, `@vitejs/plugin-react 6.1.2`, `typescript 7.0.2`, `tailwindcss` + `@tailwindcss/vite 4.3.3`,
`lucide-react 1.59.0`, `@fontsource/sigmar-one 5.3.0`, `@fontsource-variable/nunito 5.3.0`, `@pixi/react 8.0.5` (rejected), `pixi-filters 6.1.5` (rejected).

## Files

| Path (under `prototypes/board-phone/`)                          | Branch first added                   | What                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                     | each                                 | how to run, URL params per ticket                                                                                                                                                                                                                                           |
| `public/board/*.png` (22 files)                                 | board-phone                          | v1 art, renamed; byte-identical to v1 files (mapping in `notes/v1-map.md`)                                                                                                                                                                                                  |
| `src/board/data.ts`                                             | board-phone                          | Field table (id, label, kind, flip, groupId, zIndex), `GROUP_COLORS`, `PLAYER_COLORS`, `PLAYER_SPRITES`, geometry `G`, `WIDTH_NORMAL`, **`calcCoords(id)`** (verbatim v1 port), mock state                                                                                  |
| `src/board/renderer.ts`                                         | board-phone (extended in both later) | imperative PixiJS 8 Board: `createBoardRenderer(host, opts) → BoardRenderer`                                                                                                                                                                                                |
| `src/shared.tsx`                                                | board-phone                          | `BoardCanvas` (the one-React-component seam), `useTaps`, `useFit`, HUD, `useViewport`                                                                                                                                                                                       |
| `src/variants.tsx`                                              | board-phone                          | layouts A–E; **`useZoomPan`** (camera) and `VariantE` (chosen: camera + tap-to-inspect card)                                                                                                                                                                                |
| `src/PixiReactCheck.tsx`                                        | board-phone                          | `@pixi/react` check (rejected → spec: no `@pixi/react`)                                                                                                                                                                                                                     |
| `src/pick.tsx`                                                  | field-selection                      | 3 pick flows; **`Pick2` = chosen** (tap snaps to nearest eligible Field, toggles; chips tray; ⓘ inspect); `usePick`, `useBoardSync`, `useTurnClock`, Auto-sell mock                                                                                                         |
| `src/styles.css`                                                | board-phone/field-selection          | prototype chrome CSS (HUD, card, tray) — not the design system                                                                                                                                                                                                              |
| `src/ui/ui.css`                                                 | ui-direction                         | **Tailwind v4 + shadcn token setup; Tabletop tokens = `[data-dir='b']`**, `.sticker`, `.sticker-sm`, `.press`, `.tnum`, `.board-backdrop`, confetti keyframes                                                                                                               |
| `src/ui/dirs.ts`                                                | ui-direction                         | per-direction Player colours, shape badges `['●','▲','■','★']`, ring colours, `inkOn()`, `boardOptions(dir, theme)`                                                                                                                                                         |
| `src/ui/dirB.tsx`                                               | ui-direction                         | **Tabletop screens**: `LobbyListB`, `LobbyB`, `GameB` (corner cards desktop / chips phone, Minute pill + 1 toast, camera buttons), `TimerRing`, `Toasts`, `FieldCardB`, `SaleTrayB` (meter, chips, checklist, Auto-sell, Sell), `PodiumB` (2-1-3 + confetti), `Btn`, `Logo` |
| `src/ui/board.tsx`                                              | ui-direction                         | `useGameBoard` (Board + camera + sale-snap glue), `Token` (shape badge), `alien(p)`                                                                                                                                                                                         |
| `src/ui/model.ts`                                               | ui-direction                         | mock data + hu/en/de sample strings (`S`), `contrast()` (WCAG), CVD matrices `simulate()`, `minDistance()`                                                                                                                                                                  |
| `src/ui/tokens.tsx`                                             | ui-direction                         | tokens page: contrast table, Player colours under CVD                                                                                                                                                                                                                       |
| `src/ui/dirA.tsx`, `dirC.tsx`                                   | ui-direction                         | rejected directions (Yearbook, Campus HUD)                                                                                                                                                                                                                                  |
| `ui.html`, `src/ui/main.tsx`, `vite.config.ts`, `tsconfig.json` | ui-direction                         | entry for `/ui.html`; vite `server: { host: true, port: 5180 }`                                                                                                                                                                                                             |

## Reusable pieces (with the exact code to lift)

### Isometric placement — `src/board/data.ts`

- `calcCoords(id)` returns Board-local `{x,y}` for Field id 0..31 using `WIDTH_NORMAL = (2*48+32)*0.65 = 83.2`, `HEIGHT_NORMAL = WIDTH_NORMAL/2`, corners `WIDTH_CORNER = (3*48+32)*0.65`, `SPACE_X 5`, `SPACE_Y 2.5`. Board container is scaled `(1, G.boardScaleY=1.1)`. Each Field container is scaled `(flip ? -1 : 1) * 0.65` (corners never flipped). zIndex from the table (−2…−34, depth sort with `sortableChildren`).
- Spec wants "Field index → ring cell → 2:1 diamond coords"; `calcCoords` is the parity reference (comment in file: "v2 would replace it with fieldToCell + cellToScreen"). See `docs/research/isometric-rendering.md` for the clean formula.

### Renderer — `src/board/renderer.ts` (533 lines on ui-direction)

- `BoardRenderer` interface: `canvas, boardSize, fit(area?, pad=8) → Camera, setCamera, getCamera, fieldAt(x,y), nearestField(x,y) → {id, dist}, fieldCenter(id) → screen {x,y}` (← spec's test hook), `playerPos(i), setSelected(id), setMarks(Record<id,'picked'|'off'|'auto'>), setOptions, stats(), invalidate(), destroy()`.
- `app.init({ autoStart:false, backgroundAlpha:0, autoDensity:true, resolution, preference:'webgl' })`, `app.ticker.stop()`, own rAF loop that calls `app.render()` only when `dirty` (= redraw on demand).
- Per-Field stack: 2 `label_bg` tiles + 4 `ground` tiles (normal), 9 road/label tiles (corner); positions in file (`H=48, B=32, W=64.5`).
- **Hit polygon**: convex hull of each tile's top-face diamond `(x,y−49.5),(x+66,y−16.5),(x,y+16.5),(x−66,y−16.5)`; `center` = bbox centre of hull. `fieldCenter` = `c.toGlobal(center)`.
- **Baked recolour** (`bake(tex, original, target, tolerance)`): CPU port of ColorReplaceFilter → canvas texture. Label tiles: `0xc2beac → GROUP_COLORS[g]`, tol `0.095`. Houses (`haz_alap/haz_resz/haz_teto`): `0x8ab549 → player colour`, tol `1`. Spec moves this to build time (pre-coloured atlas frames) — same algorithm.
- **Picking marks**: `f.c.tint = 0x5a6070` for `off` (container tint, no filter); ring = `Graphics().poly(hullPts)` with stroke width `3 / (cam.scale * G.scale)` (constant 3 screen px); `picked` fill alpha 0.45 + lift `y −15`, zIndex 400 (selected 500).
- **Tilted labels**: wrapper `Container({rotation: Math.PI/6.66667})`, `scale(1,1.2)`, Text `skew(-Math.PI/4, 0)`, `scale(flip?-1:1,1)`; label style Arial bold 22, stroke `#eeeeee` 4; price style 45. Long label rule: `label.includes(' ') && label.length > 9` → position `(-33,7)` else `(-50,14)`; price at `(-105,43)`.
- **Re-rasterise text on settle**: 120 ms after camera change, `t.resolution = clamp(0.5, 4, opts.resolution * cam.scale * 0.65 * 1.2)`.
- Pawn badges: circle r 13 + Text over each alien (`opts.badges`); pawn anchor `(0.5, 0.7)`, x offsets `[15,5,−5,−15]` per Seat.
- `fit(area, pad)`: `s = min((a.w−2pad)/bounds.w, (a.h−2pad)/bounds.h)`, centred on `area`; bounds measured with pawns hidden.

### Camera — `src/variants.tsx` `useZoomPan(r, onTap, fitArea, fitDeps)` (lines ~50-191)

- Pointer events on canvas (`setPointerCapture`), 1 finger pan / 2 finger pinch around midpoint, wheel `scale *= exp(-deltaY*0.002)` around cursor (`{passive:false}` + `preventDefault`).
- Tap = pointer moved < 10 px and < 500 ms, single pointer.
- Limits: `minS = fit.scale*0.9`, `maxS = max(1.6, fit.scale*2)`; `clampCam` lets any Board edge reach the middle of the **fit area** (not viewport).
- Buttons: zoom ×1.5 / ÷1.5 around fit-area centre, `fit`, `follow` (zoom to `fit*2.6` if below `fit*2`, then lerp 0.12/frame toward pawn).
- `panTo(from, to)`: 250 ms cubic-out tween, zoom unchanged.
- Variant E card rule: after selecting, if `fieldCenter` is within 24 px of the card rect or off-screen → `panTo(c, portrait ? {x: w/2, y: card.top/2} : {x: card.left/2, y: h/2})`. Portrait fit area = `{x:0,y:0,w,h: h − SHEET(250) − 56}`.
- Tap-to-inspect radius (no pick): `nearestField` with `dist < max(70, stats().fieldPx)`.

### Snap radius & tray — `src/pick.tsx` `Pick2` (field-selection) + `src/ui/dirB.tsx` `SaleTrayB`

- Pick snap: nearest **eligible** Field by `fieldCenter` distance; commit toggle only if `d < max(90, fieldPx * 1.6)` (`fieldPx = WIDTH_NORMAL * cam.scale`). (`ui/board.tsx` uses `max(70, fieldPx) * 1.4` — spec picks `max(90 px, 1.6 × Field width)`.)
- Pick state → marks: not eligible `off`; picked `picked`; Sale && `left ≤ 5` && !covered && in Auto-sell list → `auto`.
- Auto-sell: eligible sorted by sale value asc, add until `total ≥ shortfall`.
- Erasmus helpers: `steps = (id − 24 + 32) % 32`, `passesStart = 24 + steps ≥ 32`.
- Tray (Pick2): chips (Group-colour dot, name, sale value / "N ahead · +250K", ✕), ⓘ inspect toggle, Turn clock ring, meter, Auto-sell, commit; portrait reserves 210 px (`RESERVE`) under the Board fit area. `useBoardSync` pans (never zooms) if focused Field is under the tray.
- Tabletop tray `SaleTrayB`: header "Rent X · Cash Y", "Shortfall: Z", timer bubble (pulses `bg-danger` ≤ 5 s), meter (`bg-warning` → `bg-success` when covered), chips or 2-col checklist (⚡ badge on Auto-sell picks), buttons `[ListChecks][⚡ Auto-sell][Sell!]`.

### Design tokens / CSS — `src/ui/ui.css` + `src/ui/dirs.ts`

- Tailwind v4 CSS-first: `@import 'tailwindcss'`, `@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));`, `@theme inline { --color-background: var(--background); … --color-p1..p4; --font-display; --font-body; --font-num; --radius-ui: var(--radius); }`. Spec: theme follows OS → in v2 use `@media (prefers-color-scheme: dark)` (or set `data-theme` from `matchMedia`).
- Tabletop values = `[data-dir='b']` / `[data-dir='b'][data-theme='dark']` blocks (identical to the spec's token table). Fonts: `@fontsource/sigmar-one` (display), `@fontsource-variable/nunito` (body + numbers, `.tnum { font-variant-numeric: tabular-nums }`). Spec wants latin-ext subset for Sigmar One (`@fontsource/sigmar-one/latin-ext.css` + `latin.css`).
- Sticker utilities: `.sticker { border: 3px solid var(--border); box-shadow: 4px 4px 0 var(--border) }`, `.sticker-sm { border: 2.5px …; box-shadow: 2px 2px 0 … }`, `.press:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--border) }`.
- `.board-backdrop` = `var(--board-bg)` radial gradient (light `#fff6ea → #ffd3a1 75%`, dark `#6a4a62 → #262335 72%`).
- Player colours `V1_PLAYERS = ['#f29db6','#8db5e7','#70c4a8','#ffcc00']` both themes; ink on them `#2b2238`; badges `['●','▲','■','★']`; rings Tabletop light `{sel:'#ff7a1a', picked:'#1f9d6e', auto:'#d6334a'}`, dark `{sel:'#ffbb6c', picked:'#5fd38d', auto:'#ff6b6b'}`.
- Logo: text "UNIversum" in `font-display text-primary`, `WebkitTextStroke: 2px var(--border)`, `textShadow: 4px 4px 0 var(--border)` (`dirB.tsx` `Logo`).
- Seat cards: `aspect-[4/5] w-[calc(50%-0.5rem)] md:w-[calc(25%-0.75rem)]`, flex-wrap centred (stay 4-Seat size); open Seat = `border-dashed bg-transparent shadow-none`; crown `lucide Crown fill #ffcc00`; held Seat `animate-pulse opacity-50 grayscale` + WifiOff "Reconnecting… 0:42".
- Room-code input: one `<input inputMode="numeric" maxLength={1}>` per digit, auto-advance (prototype has 4; v2 needs 6).
- Desktop game fit area: `{x:110, y:110, w: vw−220, h: vh−310}` (wide = `w ≥ 768 && landscape`); phone: `{x:0, y:196, w, h: h−196−(sale?250:200)}`.
- `TimerRing`: SVG circle, `strokeDasharray = 2πr`, offset `c*(1−left/20)`, stroke `--danger` when ≤ 5 s else `--primary`.

### Not reusable

`PixiReactCheck.tsx`, `pixi-filters` paths (`recolor: 'filters'`, `DropShadowFilter`), HUD/tap-test, dirA/dirC, mock prices (`mockPrice = 60_000 + id*18_000` is fake — real prices in `notes/v1-map.md`).
