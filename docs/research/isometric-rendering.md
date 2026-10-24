# Research: isometric rendering on web & mobile

- Ticket: #7 (map #1, "UNIversum v2 modernization"). Feeds grilling ticket #11.
- Date: 2026-10-18. Everything version-related below was checked on that date against npm, GitHub and the official docs listed under [Sources](#sources).
- Terms follow `GLOSSARY.md`: the **Board** is the ordered ring of **Fields**. A **Player** stands on one Field.

## Question

What is the best way in 2026 to render UNIversum's isometric Board in a React app so it runs smoothly in mobile browsers? Compare PixiJS v8 + `@pixi/react` with realistic alternatives. Cover the v6→v8 migration surface, the isometric projection, asset loading, responsive resizing, touch input and mobile performance.

The map's standing constraints apply: feature parity, responsive web that works on desktop and mobile browsers, no native app, the isometric view is fixed, the visual design of the UI is free, and the server owns the rules (ADR-0001).

## TL;DR

- **Renderer: stay on PixiJS, move to v8** (current `8.22.0`, released 2026-10-01 [S1][S2]). Every v1 library has a v8 counterpart except `pixi-projection` and the react-spring bindings. v1 never actually calls `pixi-projection`, and we drop the react-spring bindings anyway.
- **The isometric look needs no projection library.** v1 uses pre-drawn isometric sprites (Kenney packs) and places them at hand-tuned 2:1 diamond coordinates (`calcCoords`). In v2 that becomes a pure "Field index → grid cell → screen point" function plus `zIndex` depth sorting [S10].
- **React binding: `@pixi/react` v8 is risky right now.** The latest release is 8.0.5 (2025-12-01). It pins `react-reconciler` 0.31.0, an issue about React 19.2 support is still open, and React itself is on 19.3.1 [S3][S4][S5]. There is also an open WebGL crash on remount/StrictMode [S6], and no react-spring support for v8 [S7]. The lower-risk choice is **a small imperative Board renderer (plain PixiJS v8) behind one React component**. `@pixi/react` stays the fallback if a prototype shows it works with the React version we pick.
- **The biggest performance problem is filters, not PixiJS.** v1 runs roughly 40–100+ filter passes per frame: a `ColorReplaceFilter` per label sprite and per building floor, plus a full-Board `DropShadowFilter`. PixiJS's own docs call filters expensive [S8]. Use `tint` and pre-coloured atlas frames instead, and bake the shadow into the art.
- **Mobile is a layout problem before it is a speed problem.** Scaled to fit, a normal Field is about **20 CSS px wide in portrait and about 34 px in landscape**. That is below the WCAG 24×24 px minimum tap target [S20]. We need a decision on zoom/pan, an orientation policy, or a separate way to tap a Field.
- **Prototype: yes, worth doing, time-boxed (1–2 days).** It answers three things: label readability and tap accuracy on a real phone, `@pixi/react` vs imperative on React 19.3, and frame rate with tint instead of filters.

## How v1 renders the Board today

Files: `client/src/Components/GameComponentNew.jsx`, `client/src/Components/GameComponents/*.jsx`, `client/src/Utils/calcCoords.js`, `client/src/gameConfig.js`, `client/src/Pages/Game.jsx`.

- **Stack:** `pixi.js ^6.3.0`, `@inlet/react-pixi ^6.6.5` (plus its `/animated` entry used with `react-spring` `<Spring native>`), `pixi-filters ^4.1.6`, `pixi-projection ^0.4.4`, React 17 (`client/package.json`). `@inlet/react-pixi` is deprecated on npm in favour of `@pixi/react` [S3].
- **`pixi-projection` is unused.** It is a dependency, but nothing under `client/src` imports it. Its last npm release (1.0.0, 2023-04) targets `@pixi/core ^7.2` and there is no v8 build [S3].
- **Stage:** one `<Stage>` fixed at `1920×1080` (`GAME_CONFIG.width/height`), `backgroundAlpha: 0`, `antialias: true`, `resolution: PIXI.settings.RESOLUTION` (that is 1). Nothing resizes it. A global CSS rule shrinks the canvas with `max-width: 100vw; max-height: 100vh` (`client/src/global.css`). The backing store stays 1920×1080 at DPR 1, so the Board is blurry on high-DPI phones. Because the two max constraints apply separately, the aspect ratio can also distort.
- **Isometric layout:** `calcCoords(id)` hard-codes the screen position of each of the 32 Fields: 4 corners (ids 0/8/16/24) and four sides of 7. It uses a 2:1 diamond (`HEIGHT = WIDTH / 2`) plus spacing fudges. The Board container is scaled `[1, 1.1]`. Each Field component stacks ground and label sprites from Kenney _isometric city/landscape_ tiles and sorts them by `zIndex` (`sortableChildren`). Labels are Pixi `Text` objects, skewed and rotated so they sit on the tile. Nothing is projected at runtime: the art is already isometric.
- **Board size:** Field centres span about ±747 px horizontally and ±410 px vertically. With the tile art that makes a Board about **1600×950 logical px** (computed from `calcCoords` and `GAME_CONFIG`).
- **Scene size:** 20 normal Fields, 4 corners, 4 museums, 3 chance Fields and 1 tax Field. Each has 8–14 Sprites/Texts, which comes to about 300 display objects, plus building floors and 4 Player characters. That is tiny by PixiJS standards [S8].
- **Filters (the real cost):**
  - a `DropShadowFilter` on the whole Board container;
  - a `ColorReplaceFilter` on each Field's 2 label sprites (Field group colour);
  - a `ColorReplaceFilter` on every building floor (owner colour);
  - a `CRTFilter` on Fields that cannot be selected;
  - a `GlowFilter` on selected Fields.

  Every filter is an off-screen render pass. Filter objects and `TextStyle`s are also re-created on **every React render** (`new DropShadowFilter(...)` in the component body).

- **Textures:** `PIXI.Texture.from('../Images/...')` URL loads in every component body. Paths mix `../Images/` and `../images/`, but git only has `client/public/images/`. On a case-sensitive host those textures 404. v6 hides that failure; v8's `Assets.load` rejects instead. `public/images` holds 1,512 PNGs (about 22 MB), of which the Board uses about 25.
- **Input:** `interactive={true}` on Field containers with `pointerdown/pointerup/pointerupoutside/pointercancel`, plus a manual "is pointer down" flag. Hit testing uses each container's rectangular bounds, which overlap on a diamond layout. No `hitArea` is set.
- **Animation:** react-spring `<Spring native>` animates Player movement (one Field per 300 ms), falling building floors and the doubler drop.
- **Rules inside the renderer:** `Character.jsx` dispatches `giveRoundBonus()` when a Player's walk passes Start. `NormalComponentNew.jsx` computes Erasmus distances and dispatches `nextPlayer()`. Under ADR-0001 this all moves to the server. The v2 renderer must be a pure view of the state it is given.

## Options compared

### A. PixiJS v8 + `@pixi/react` v8 (declarative JSX)

- `@pixi/react` 8.x: "React v19 support, PixiJS v8 support". Components are registered with `extend({...})` and written as `<pixiSprite>`. The library provides `useTick`, `useApplication`, and `<Application resizeTo={ref}>` [S4].
- **Peer dependencies:** `react >=19.0.0`, `pixi.js ^8.2.6`. It **pins `react-reconciler` 0.31.0** [S3]. The client must therefore move from React 17 to 19 (it has to anyway).
- **Maintenance as of 2026-10-18:** latest release v8.0.5 (2025-12-01), last push to `main` 2026-01-16 [S5]. Open issues that matter here:
  - React 19.2 support (#630): users report ESM resolution errors with React 19.2 [S5].
  - WebGL crash when the app is unmounted and mounted again, or under StrictMode (#613) [S6].
  - No react-spring support for v8 (#553) [S7].
  - GPU memory leak when the `draw` prop changes (#648) [S5].
  - "Render only on prop change" is still a feature request (#536) [S5].
- **Fit:** good ergonomics if it works on our React version. It is a third-party reconciler on the critical path, and it has been quiet for about 10 months.

### B. PixiJS v8, imperative, behind one React component (recommended)

- A plain `Application` is created in an effect: `new Application()` + `await app.init()`, which is async in v8 [S9]. It is destroyed with `app.destroy({ releaseGlobalResources: true })` on unmount (pixijs-performance skill). React passes it the Board state, and the renderer diffs it. On a Board of 32 Fields that is cheap, because the scene structure never changes and only levels, owners and Player positions do.
- **The seam is small:** `createBoardRenderer(el)`, then `.setState(boardView)`, `.onFieldTap(cb)` and `.destroy()`. No reconciler dependency, and render-on-demand is easy (see Mobile performance).
- **Costs:** we write the diffing ourselves, and an async `init` racing a StrictMode double-mount must be guarded.

### C. DOM/CSS (absolutely positioned `<img>` + HTML text)

- The art is already isometric, so CSS only has to place images at the same iso coordinates. About 300 DOM nodes is trivial for a browser. Text is native and crisp, easy to localise and accessible. Animation can use Motion's `animate()`, which also works on plain objects [S19].
- **Costs:**
  - recolouring needs pre-coloured images or CSS `filter`s;
  - depth sorting is done by hand;
  - every effect becomes a DOM/compositor cost;
  - it throws away the v1 Pixi structure.

  A credible **fallback** if B or A disappoints on phones, not the first choice.

### D. Phaser 4

- Phaser 4.0.0 shipped 2026-04-10; latest 4.2.1 (2026-07-09) [S11]. Tilemaps support isometric orientation through `TilemapLayer`. The GPU tilemap layer is orthographic only [S12].
- React integration is the official template's "bridge": a `PhaserGame.tsx` component plus an `EventBus` [S13]. It is not declarative.
- **Fit:** a full game engine (scenes, physics, loader) for a 32-Field Board that hardly changes. More runtime and new concepts, and no gain over A/B.

### E. Konva / react-konva

- react-konva 19.3.2 (peer `react ^19.3.0`), konva 10.9.0 [S3]. Konva is "a 2D canvas framework" [S14]. To filter an image you "have to cache it first", and the filters run on Canvas 2D pixels [S15].
- **Fit:** the React binding keeps up with React well, but there is no GPU batching and effects like glow and recolour cost CPU. A worse fit than Pixi for sprite-heavy art.

### F. Three.js / React Three Fiber (orthographic camera)

- three 0.186.1, `@react-three/fiber` 9.8.2 (peer `react >=19 <19.4`) [S3].
- **Fit:** true 3D with an orthographic iso camera. It only pays off with 3D assets, and the fixed isometric view is already met by the 2D art. Overkill.

## v6 → v8 migration surface (only what v1 uses)

v1 is on v6, so the v6→v7 notes apply too: `Loader` was replaced by `Assets`, and `InteractionManager` by `EventSystem` [S16].

| v1 (Pixi 6 / @inlet/react-pixi)                                                        | v8 replacement                                                                                                 | Source    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| `@inlet/react-pixi` `<Stage options>`                                                  | `@pixi/react` `<Application>` (A), or `new Application()` + `await app.init({...})` (B)                        | [S4][S9]  |
| `@inlet/react-pixi/animated` + react-spring `<Spring native>`                          | Nothing official (#553). Use `useTick`/`app.ticker` with our own tween, or Motion `animate()` on plain objects | [S7][S19] |
| `PIXI.Texture.from(url)` loads a URL                                                   | No longer loads: `await Assets.load(...)` first, then `Texture.from(alias)`                                    | [S9]      |
| `PIXI.settings.RESOLUTION`                                                             | `settings` removed: pass `resolution` / `autoDensity` to `init` (or `AbstractRenderer.defaultOptions`)         | [S9]      |
| `interactive={true}`                                                                   | `eventMode = 'static'` (`interactive` still works as an alias)                                                 | [S9][S17] |
| `pointerdown`+`pointerup`+`isPointerDown` flag                                         | `pointertap`                                                                                                   | [S17]     |
| `pointermove` fired on any canvas move                                                 | Fires only over the object; use `globalpointermove`                                                            | [S17]     |
| `new Text(text, style)` / `new TextStyle({ stroke: '#eee', strokeThickness: 4 })`      | `new Text({ text, style })`; `stroke: { color, width }`                                                        | [S9][S18] |
| `anchor` / `skew` / `rotation` / `zIndex` + `sortableChildren` on Containers           | Same concepts; leaf nodes (Sprite, Text) can no longer have children                                           | [S9][S10] |
| `pixi-filters@4` (`DropShadowFilter`, `ColorReplaceFilter`, `CRTFilter`, `GlowFilter`) | `pixi-filters@6.1.5` (for Pixi v8), imported per filter from `pixi-filters/<name>`. All four exist             | [S3][S21] |
| `pixi-projection` (unused)                                                             | Drop it. If ever needed, v8 has `PerspectiveMesh` built in                                                     | [S3][S22] |
| `container.name`, `cacheAsBitmap` (if introduced)                                      | `label`, `cacheAsTexture()`                                                                                    | [S9]      |
| Automatic culling                                                                      | Manual (`cullable` + `Culler` / `CullerPlugin`); not needed for one screen                                     | [S9]      |

## Isometric projection approach

- **Keep 2D isometric art and compute positions.** No projection or 3D library is needed. Replace `calcCoords`'s per-side constants with:
  1. `fieldToCell(index) → (gx, gy)`, which walks the 32-Field ring on a 9×9 grid with corners at 0/8/16/24;
  2. `cellToScreen(gx, gy) = ((gx − gy)·W/2, (gx + gy)·H/2)` with `H = W/2`, the same 2:1 ratio v1 uses.

  Corner Fields keep their larger footprint as an offset. Both functions are pure and unit-testable.

- **Depth:** set `zIndex = gx + gy` (plus a small layer offset for building floors and Players) inside a `sortableChildren` Board container [S10]. Players walking along the ring get their `zIndex` recomputed per step.
- **Text on tiles:** v1 skews and rotates `Text` to sit on the tile. That still works in v8. Text re-rasterises on every change [S8], which is fine because labels change rarely. If tilted text looks poor at phone scale, show the label on tap in the HTML UI instead (see open questions).
- **Hit testing:** give each Field a diamond `Polygon` `hitArea` matching its top face. This fixes overlapping rectangular bounds and skips recursive child checks. Set `interactiveChildren = false` on Fields [S8][S17].

## Asset loading

- Load everything the Board needs up front with `Assets.init({ manifest })` + `Assets.loadBundle('board')`, behind the existing loading screen. Texture formats like `{webp,png}` are chosen per device [S23][S24].
- Pack the ~25 Board textures into **one spritesheet** with AssetPack (`@assetpack/core` 1.7.0). Its texture-packer pipe outputs `@1x` and `@0.5x` atlases and can compress to WebP/AVIF [S3][S25].
  - Batching: one texture source means fewer batch breaks [S8].
  - `@0.5x` gives low-end phones half-resolution textures automatically [S8].
- Recolouring: render group and owner colours with **`tint`** on white or greyscale art regions. Tint does not break batches, which `ColorReplaceFilter` does. Where tint cannot reproduce the look, use pre-coloured atlas frames (4 Player colours × floors).
- Fix the `Images`/`images` path-case bug while moving to `Assets`, since `Assets.load` will reject.

## Responsive resize

- Size the canvas to the Board's DOM container (`resizeTo`), not to a fixed 1920×1080.
  - The ResizePlugin listens to `window` `resize`, throttles with rAF, and reads `clientWidth/Height` for an element [S26][S27].
  - It does **not** observe the element itself. If the container can change size without a window resize (side panels, a drawer), add a `ResizeObserver` that calls `app.resize()`.
- On resize, fit the Board container: `scale = min(w / boardW, h / boardH)`, then centre it. The Board's logical size is a constant, about 1600×950.
- Sharpness: `resolution: devicePixelRatio` + `autoDensity: true` [S28]. Recommendation (not sourced): cap the resolution at 2 to bound fill-rate on 3× phones, and measure that in the prototype.
- **What fit-to-screen gives on phones:** the Board is about 1.7:1.
  - Portrait 390 px wide → scale ≈ 0.24 → a normal Field is ≈ 20 px wide (≈ 10 px tall diamond).
  - Landscape 844×390 → scale ≈ 0.41 → ≈ 34×17 px.

  Both are below the WCAG 2.2 minimum target of 24×24 CSS px [S20]. Field labels would be about 5–9 px. This is the main open question for #11.

## Touch input

- PixiJS's federated events give one pointer model for mouse, touch and pen [S17]. Use `pointertap` on Fields with `eventMode = 'static'`.
- PixiJS sets `touch-action: none` on its canvas [S29], so the browser does not pan or pinch-zoom over the canvas. If we want pinch-zoom or pan on phones, we do it in the app (e.g. `pixi-viewport` 6.0.3, peer `pixi.js >=8`, last published 2024-11 [S3]) or with our own two-pointer handler. A zoom that keeps the camera angle does not break the fixed isometric view, but it is a product decision.
- `autoPreventDefault` defaults to true for mouse/touch events [S30]. Keep it, but make sure HTML overlays (buy and sell panels) sit outside the canvas so they keep normal scrolling.
- Taps on Fields become **intents sent to the server** (ADR-0001). The renderer only highlights what the server says is selectable.

## Mobile performance

1. **Remove per-sprite filters** (see Asset loading). Each filter is an extra pass. PixiJS's docs: "Filters are expensive, using too many will start to slow things down!" [S8].
   - Keep at most one cheap effect for highlighting.
   - If any filter stays, create it once and set a `filterArea` [S8]. Never create filters in a render body.
2. **Bake the drop shadow** into the art, or cache the static ground layer with `cacheAsTexture()` and refresh it only when it changes [S8][S31].
3. **Use one atlas** so the static Board batches into a handful of draw calls [S8].
4. **Render on demand:** the Board is idle most of the time.
   - Option 1: `autoStart: false` + `app.render()` after a state change or while a tween is running.
   - Option 2: cap the ticker with `maxFPS` [S28][S32].

   Either saves battery compared with v1's constant 60 fps redraw of a static scene.

5. **Renderer:** PixiJS auto-detect still prefers WebGL as "the most tested safe API" [S33]. WebGPU now ships in Safari 26 on iOS [S34], but there is no need to force it. A Canvas 2D renderer exists as an experimental fallback since 8.16.0 (2026-02-03) [S2].
6. For older phones the docs suggest `antialias: false` and `backgroundAlpha: 1` [S8]. v1 uses `antialias: true` and a transparent background over a CSS image, so the prototype should measure this.
7. Recent v8 releases include iOS-specific fixes (e.g. mip range on iOS 18.0–18.1 in 8.18.0) [S2]. Stay current within 8.x.

## Comparison

|                                       | A. Pixi v8 + @pixi/react                  | B. Pixi v8 imperative               | C. DOM/CSS                        | D. Phaser 4                  | E. react-konva                    | F. R3F/three     |
| ------------------------------------- | ----------------------------------------- | ----------------------------------- | --------------------------------- | ---------------------------- | --------------------------------- | ---------------- |
| Reuses v1 scene model and art         | Yes                                       | Yes                                 | Art only                          | Art only                     | Art only                          | Needs rework     |
| GPU batching / mobile frame rate      | Good (once filters are gone)              | Good (once filters are gone)        | Fine for ~300 nodes; effects cost | Good                         | CPU Canvas 2D; filters need cache | Good             |
| Isometric support                     | Manual math (trivial)                     | Manual math (trivial)               | Manual math                       | Iso tilemaps (non-GPU layer) | Manual math                       | Ortho camera     |
| React 19.3 compatibility (2026-10-18) | **Uncertain** (reconciler 0.31 pin, #630) | None needed                         | Native                            | Bridge (EventBus)            | Yes (peer ^19.3)                  | Peer `<19.4`     |
| Maintenance signal                    | Last release 2025-12                      | Pixi core: releases every few weeks | n/a                               | Active (4.2.1, 2026-07)      | Active (2026-10)                  | Active (2026-10) |
| Animation story                       | No react-spring; `useTick`                | Ticker + own tween / Motion         | Motion / CSS                      | Built-in tweens              | Konva tweens                      | R3F `useFrame`   |
| Text quality / i18n                   | Canvas text                               | Canvas text                         | Best (native)                     | Canvas text                  | Canvas text                       | Needs SDF text   |
| Migration effort from v1              | Medium                                    | Medium                              | High                              | High                         | High                              | Very high        |

## Recommendation

**Use PixiJS v8 (latest 8.x) with a thin imperative Board renderer (option B) behind a single React component, and drop every per-sprite filter in favour of tint plus one atlas.**

Why:

- It keeps v1's art, scene structure and isometric approach.
- It removes the dependency on a reconciler that has not followed React past 19.0.
- It makes render-on-demand and the "pure view of server state" rule (ADR-0001) easy to enforce.

Trade-offs accepted:

- We give up JSX for the scene graph.
- We write a small state→scene diff, which is easy for 32 fixed Fields.
- We own the tweening.

When to pick A instead: if the prototype shows `@pixi/react` 8.x runs cleanly with React 19.3 (no ESM or reconciler errors, no remount crash), A is acceptable and more idiomatic. Keep the same seam so the two are interchangeable.

When to fall back to C: if canvas text stays unreadable at phone scale and the grilling decides the Board must be fully legible in portrait without zoom, DOM rendering becomes the stronger option.

## Is a mobile prototype worth doing?

**Yes.** The map already lists "a mobile prototype of the isometric Board, if the rendering research leaves doubt", and doubt remains on three points that reading cannot settle:

1. **Legibility and tapping:** at fit-to-screen scale, Fields are 20–34 px wide. Can Players read labels and hit the right Field, or do we need zoom/pan or tap-to-inspect?
2. **Binding:** does `@pixi/react` 8.0.5 work with React 19.3 (+ StrictMode, remount)? If not, B is confirmed.
3. **Frame rate and battery:** the full Board with tint and no filters, `resolution` ≤ 2, render-on-demand. Test on one mid/low-end Android (Chrome) and one iPhone (Safari 26).

Scope: a throwaway route rendering the 32-Field Board from a static mock state, with one Player walking around the ring and Field-tap logging. 1–2 days.

## Open questions for the grilling ticket (#11)

1. **Phone layout:** fit-to-screen only, pinch-zoom/pan (camera angle stays fixed), or a forced or suggested landscape orientation? Is portrait play a requirement?
2. **Field selection on phones:** tap on the canvas only, or also from an HTML list or panel (more accessible, bigger targets)?
3. **Field labels:** stay as tilted canvas text on the tiles, move to an on-tap HTML card, or both? Labels are hard-coded Hungarian or mixed today (`Karantén`, `esély`, `adó`). Do they get hu/en/de translations?
4. **Visual effects:** keep v1's look (drop shadow, CRT "disabled" effect, glow "selected" effect) or redesign the highlights? The UI visual design is free, so cheap effects are allowed.
5. **React version and binding:** commit to React 19.3, and to the imperative renderer (B) unless the prototype proves `@pixi/react` (A)?
6. **Animation timing:** Player walks are driven by the server's state transition (from Field → to Field). Who decides the step timing, and must the client finish an animation before the next server event applies?
7. **Assets:** prune `public/images` (1,512 PNGs, about 22 MB) down to one Board atlas + UI images via AssetPack? Keep a `@0.5x` tier for low-end phones?

## Sources

- [S1] npm registry, `pixi.js` dist-tags (latest 8.22.0, published 2026-10-01): https://registry.npmjs.org/pixi.js
- [S2] PixiJS GitHub releases (v8.16.0 Canvas renderer, experimental; v8.18.0 iOS 18.0–18.1 mip fix; v8.22.0): https://github.com/pixijs/pixijs/releases
- [S3] npm registry metadata, read 2026-10-18: `@pixi/react` (8.0.5, peers `react >=19.0.0`, `pixi.js ^8.2.6`, dep `react-reconciler 0.31.0`), `@inlet/react-pixi` (6.8.0, deprecated → `@pixi/react`), `@pixi/react-animated` (7.1.3, peer `@pixi/react <8`), `pixi-projection` (1.0.0, peers `@pixi/core ^7.2`), `pixi-filters` (6.1.5, peer `pixi.js >=8`), `pixi-viewport` (6.0.3, peer `pixi.js >=8`), `react` (19.3.1), `react-konva` (19.3.2), `konva` (10.9.0), `three` (0.186.1), `@react-three/fiber` (9.8.2), `phaser` (4.2.1), `@assetpack/core` (1.7.0): https://registry.npmjs.org/<package>
- [S4] `@pixi/react` README (extend, `<Application resizeTo>`, `useTick`, React 19 / Pixi v8): https://github.com/pixijs/pixi-react/blob/main/README.md
- [S5] `@pixi/react` repo, releases and open issues (#630 React 19.2, #648, #536): https://github.com/pixijs/pixi-react/releases, https://github.com/pixijs/pixi-react/issues/630
- [S6] `@pixi/react` issue #613, crash with WebGL + StrictMode / remount: https://github.com/pixijs/pixi-react/issues/613
- [S7] `@pixi/react` issue #553, react-spring support for v8: https://github.com/pixijs/pixi-react/issues/553
- [S8] PixiJS docs, Performance Tips: https://pixijs.download/release/docs/core-concepts-7.html.md
- [S9] PixiJS docs, v8 Migration Guide: https://pixijs.download/release/docs/migrations.html.md
- [S10] PixiJS docs, Scene Graph (`sortableChildren` + `zIndex`): https://pixijs.download/release/docs/core-concepts-1.html.md
- [S11] Phaser GitHub releases (v4.0.0 2026-04-10, v4.2.1 2026-07-09): https://github.com/phaserjs/phaser/releases
- [S12] Phaser API docs, Tilemap / TilemapLayer orientations: https://docs.phaser.io/api-documentation/class/tilemaps-tilemaplayer
- [S13] Phaser official React template (PhaserGame bridge + EventBus): https://github.com/phaserjs/template-react-ts
- [S14] Konva README: https://github.com/konvajs/konva
- [S15] Konva docs, Blur filter ("cache it first"): https://github.com/konvajs/site/blob/master/content/docs/filters/Blur.mdx
- [S16] PixiJS docs, v7 Migration Guide (Loader → Assets, InteractionManager → EventSystem): https://pixijs.download/release/docs/migrations-1.html.md
- [S17] PixiJS docs, Events overview (eventMode, pointer/touch events, `globalpointermove`, `hitArea`): https://pixijs.download/release/docs/events.html.md
- [S18] PixiJS docs, TextStyle (`stroke: { color, width }`): https://pixijs.download/release/docs/text.TextStyle.html.md
- [S19] Motion docs, `animate()` on plain objects: https://motion.dev/docs/animate
- [S20] W3C, WCAG 2.2 Understanding SC 2.5.8 Target Size (Minimum), 24×24 CSS px: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [S21] pixi-filters README (v6.x for Pixi v8; ColorReplace, CRT, DropShadow, Glow): https://github.com/pixijs/filters/blob/main/README.md
- [S22] PixiJS docs, PerspectiveMesh: https://pixijs.download/release/docs/scene.PerspectiveMesh.html.md
- [S23] PixiJS docs, Assets overview (formats, `texturePreference`): https://pixijs.download/release/docs/assets.html.md
- [S24] PixiJS docs, Manifests and bundles: https://pixijs.download/release/docs/assets-2.html.md
- [S25] AssetPack docs, Texture Packer pipe (`tps` tag, `@1x`/`@0.5x`, WebP/AVIF via compress): https://pixijs.io/assetpack/docs/guide/pipes/texture-packer/
- [S26] PixiJS docs, Resize Plugin: https://pixijs.download/release/docs/app-2.html.md
- [S27] PixiJS source v8.22.0, `src/app/ResizePlugin.ts` (window `resize` listener; `clientWidth/Height`): https://github.com/pixijs/pixijs/blob/v8.22.0/src/app/ResizePlugin.ts
- [S28] PixiJS docs, ApplicationOptions (`resolution`, `autoDensity`, `preference`, `resizeTo`, `autoStart`): https://pixijs.download/release/docs/app.ApplicationOptions.html.md
- [S29] PixiJS source v8.22.0, `src/events/EventSystem.ts` (`style.touchAction = 'none'`): https://github.com/pixijs/pixijs/blob/v8.22.0/src/events/EventSystem.ts
- [S30] PixiJS docs, EventSystem (`autoPreventDefault`): https://pixijs.download/release/docs/events.EventSystem.html.md
- [S31] PixiJS docs, Cache as Texture: https://pixijs.download/release/docs/scene-2.html.md
- [S32] PixiJS docs, Ticker (`maxFPS`): https://pixijs.download/release/docs/ticker.Ticker.html.md
- [S33] PixiJS docs, `autoDetectRenderer` ("prioritize the WebGL renderer as it is the most tested safe API"): https://pixijs.download/release/docs/rendering.autoDetectRenderer.html.md
- [S34] WebKit blog, WebKit Features in Safari 26.0 (WebGPU on iOS/iPadOS/macOS): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- v1 code (repo): `client/package.json`, `client/src/Components/GameComponentNew.jsx`, `client/src/Components/GameComponents/{NormalComponentNew,CornerComponentNew,Building,Character,CountdownBoard}.jsx`, `client/src/Utils/calcCoords.js`, `client/src/gameConfig.js`, `client/src/Pages/Game.jsx`, `client/src/global.css`; ADR `docs/adr/0001-server-owns-the-game-rules.md`.
