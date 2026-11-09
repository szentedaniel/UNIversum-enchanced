# Ticket #38 (Board art, camera, Field card) — extension points

Branch `ticket/38-board-camera`. All under `apps/web` unless noted.

## Atlas (build time)

- `apps/web/scripts/atlas.ts`: `recolour(rgba, from, to, tolerance)` (v1 ColorReplaceFilter maths, integer, in place) + `buildAtlas({output, cache})`. Stages PNG frames to `node_modules/.cache/universum-atlas/…/raw/board{m}/board{tps}/`, runs AssetPack `pixiPipes` (PNG only — WebP was bigger; resolutions 1 and 0.5; no cache-bust) into `public/atlas/` (**gitignored**) → `manifest.json` + `board/board.png.json` / `board@0.5x.png.json`.
- Run by the Vite plugin `boardAtlas()` in `vite.config.ts` (`buildStart`, dev and build; skipped under `VITEST`), or `pnpm --filter @universum/web run atlas`.
- Frame names: `label`, `label_g1..8`, `ground`, `road`, `road_left/right/top`, `house_base|house_storey|house_roof_p0..3`, `museum`, `museum_p0..3`, `doubler`, `quarantine`, `erasmus`, `diploma`, `start_sign`, `chest_e`, `chest_n`, `tax`, `alien_p0..3`. Add a frame: add an entry to `SOURCES` (optional `maxSize`, `recolour`). v1 colours: labels `0xc2beac` tol 0.095; houses `0xd8d2be` tol 1 (NOT 0x8ab549 as the prototype had); museum `0xc2bea8` tol 0.05.
- Deps: `@assetpack/core` 1.7.0, `sharp` 0.34.5 (catalog). `allowBuilds` in pnpm-workspace.yaml sets sharp / ffmpeg-installer / cpu-features to false (prebuilt binaries; ffmpeg unused).
- Test: `test/atlas.test.ts`.

## Renderer (`src/board/`)

- `layout.ts`: Board units = v1 art px. `fieldToCell` (9×9 ring) → `cellToPoint` (corner cells 3×3 tiles, others 2×3, gap 0.1 tile; 2:1 iso, ring centre at 0,0). `isMirrored(cell)` = v1 flip (edges 9–15, 25–31). `FIELD_WIDTH` for tap reach.
- `art.ts`: `createFieldArt(field, label, frames)` → `{container, centre, outline, texts, setLook({ownerSeat, level, hasDoubler, note}), setRing}`. v1 stack positions; houses/Museum/Doubler/tile note rebuilt in `setLook` (cheap, keyed by JSON). Pick marks (#39): add a `setMark` here next to `setRing` (container tint `0x5a6070` for "off", lift + green ring for picked, orange for Auto-sell).
- `camera.ts`: pure maths (`fitCamera`, `scaleLimits` = 0.9×fit … max(1, 2×fit), `zoomAround`, `clampCamera`).
- `gestures.ts`: pointer/wheel → `GestureTarget` (`move`, `tap`, `moved`).
- `board.ts` `createBoard(host, fitAreaEl, options)` → `Board`: `update`, `setSelected`, `reveal(id, obstacleRects)` (pan only, 250 ms), `zoomBy`, `fit`, `setFollow`, `fieldCenter` (viewport px), `camera()`, `view`. Options: `fieldLabel`, `fieldNote(view,id)` (compact Rent on tile), `onFieldTap(id|null)` (nearest Field within `max(90px, 1.6×FIELD_WIDTH×scale)`; null = far tap → closes card), `onFollowChange`.
  - **Picks (#39)**: route taps by mode — today `onFieldTap` always opens the card; during a pick the snap should consider only pickable Fields (filter the nearest loop in `tap()`).
  - Turn change (`view.turn` differs) → animated fit unless Follow is on. A resize re-fits only while the camera is still at fit; otherwise clamps.
  - Text re-rasterised 120 ms after zoom changes (`settleText`).
  - Atlas loaded once per page through `Assets.init({basePath:'/atlas/', manifest})`; half resolution when `navigator.deviceMemory <= 2`.
- `Board.tsx`: the bridge + camera buttons (aria: "Zoom in", "Zoom out", "Fit the Board", "Follow" with aria-pressed). Subscribes to `roomStore.push`, `uiStore.selectedField` (→ `setSelected` + `reveal` against every `[data-board-obstacle]` element, one rAF after render), `uiStore.follow`.
- **Fit area**: `.board-fit-area` (styles.css, `@layer components`) = the Board box minus `--board-inset-top/right/bottom/left`, set as Tailwind arbitrary properties on the Board's parent in `screens/Game.tsx` (phone: top 3.75rem for the camera-button row, bottom 14rem for the card; phone landscape: right 17.5rem; wide: left/right 3.75rem). The bottom slot shows the Turn card, or `FieldCard` while `uiStore.selectedField` is set (#39: the pick tray goes in the same slot). Mark overlays with `data-board-obstacle`; never resize the Board box when a card/tray opens (that would change the zoom).
- Camera buttons: #40's `Button size="icon"` + lucide icons inside `Board.tsx` (row on phone, column on `wide:`). Pawn badges use #40's `board/badge.ts` (`pawnBadge`, scaled ×2.2).
- Known: #40's `wide` query (≥48rem and landscape) also matches landscape phones (852×393), where the desktop layout leaves the Board box ~80 px tall. Fix belongs to the layout (e.g. add a min-height to the query).
- `field-facts.ts` `fieldFacts(view, id)`: the ONE mapping view → card/tile numbers. `rent`/`value` are `null` until #26's numbers are in the view — wire them there.
- `FieldCard.tsx` `<FieldCard id view className?>` (Tabletop sticker): band (Group/kind colour), kind, `<h2>` name, Rent/Level/Value tiles + owner token (ownable only), ‹ › (aria "Previous Field"/"Next Field"), ✕ "Close"; `data-testid="field-card"`, `data-board-obstacle`.
- `uiStore`: `selectedField`, `follow`/`setFollow`.
- `text.ts`: `fieldKindName(kind)`, `formatCompactMoney`. Messages: `field_card*`, `field_kind_*`, `camera_*`.

## E2E

- `apps/e2e/tests/test-hooks.ts`: the one `declare global { Window.universumTest }` for all specs (fieldCenter, camera, view). Extend it there, don't redeclare in specs.
- `field-card.spec.ts` (both single-browser projects): `startGame(page, browser)` helper (2-Player Room, second Guest opens `/room/:code` in a fresh context), `settledScale(page)` waits for camera tweens.
