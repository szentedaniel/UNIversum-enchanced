# PROTOTYPE, throwaway: isometric Board on a phone

Answers the map ticket "Prototype: isometric Board on a phone" (#14). Lives only on the
`prototype/board-phone` branch and is never merged into main.

```sh
cd prototypes/board-phone && npm install && npm run dev
```

Open the printed `Network:` URL on a phone on the same Wi-Fi.

- `?variant=A|B|C|D|E` (or the bottom bar / arrow keys): A Fit, tap direct · B Zoom & pan ·
  C Tap-to-inspect · D Landscape + panel · **E = C + B, the chosen layout**
- HUD (top-left pill): fps, draw calls, on-screen Field width and label size, recolour mode
  (baked / tint / v1 filters), render on demand vs every frame, resolution, and a 10-round tap test
- `?page=pixi-react`: the same Board through `@pixi/react` 8.0.5 under StrictMode, with remount
  and live updates
- Flags: `?aa=1` antialias, `?gpu=webgpu`

The art is v1's (copied from `client/public/images/game`), and the layout is a straight port of v1's
`calcCoords`. The game state is a static mock.
