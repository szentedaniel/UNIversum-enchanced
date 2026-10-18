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

## `?page=pick`: picking several Fields with the Field card (ticket #15)

Lives on the `prototype/field-selection` branch (built on `prototype/board-phone`, never merged).
Three pick flows on variant E's camera, each with three scenarios:

- `?v=1` **Toggle on the card**: E unchanged; the card's button adds / removes; ‹ › steps eligible Fields (HUD: or all)
- `?v=2` **Tap toggles the Board**: no card; taps snap to the nearest *eligible* Field and toggle it; chips in a tray; ⓘ = inspect mode
- `?v=3` **Checklist in the sheet**: rows of eligible Fields (Sale: cheapest first, Auto-sell's picks badged); rows and Board taps toggle the same pick
- `?pick=sale|doubler|erasmus` (or the top control). Sale: Rent 1.67M, cash 1.25M, Shortfall 420K; Sell unlocks at ≥ Shortfall.
- Turn timer 20 s; in the last 5 s the Board rings what Auto-sell would take. `?clock=off` (or the HUD) pauses it.
- Not pickable Fields are greyed by container tint (no filters). The HUD (top-left pill) shows the full pick state.

## `/ui.html`: UI visual direction (ticket #16)

Lives on the `prototype/ui-direction` branch (built on `prototype/field-selection`, never merged).

```sh
cd prototypes/board-phone && npm install && npm run ui
```

Three directions, each with its own layout (not only colours) on the same mock state, in Tailwind v4 with
shadcn-style tokens (`src/ui/ui.css`) and Player colours in `src/ui/dirs.ts`:

- `?dir=a` **Yearbook**: paper, ink, a serif (Fraunces + Public Sans). Catalogue table, seminar-table Lobby, Board + ruled side ledger, diploma result.
- `?dir=b` **Tabletop**: v1's sunset purple + cream, sticker cards (Sigmar One + Nunito). Tiles, big Seat cards, Players in the four corners like v1, podium.
- `?dir=c` **Campus HUD**: neutral glass over a full-bleed Board (Inter + Geist Mono). Command-palette list, form Lobby, corner HUD clusters, data-table result.

The bottom bar (or ← →) switches direction, and its menus set:

- `?screen=list|lobby|game|sale|result|tokens`. `sale` is the #15 Sale pick (tap toggles; the tray holds chips, the Shortfall meter, Auto-sell, Sell and the checklist). `tokens` shows the tokens in light + dark, WCAG contrast and the Player colours under CVD simulation.
- `?theme=light|dark` (default: the OS setting), `?lang=en|hu|de` (key strings only, to check text length)
- `?cvd=protan|deutan|tritan|achroma` (SVG colour-matrix filter over the whole page, the Board canvas included)
- `?frame=devices|themes` puts phone 390×844 and desktop 1440×900 side by side, or desktop light and dark.

The Board renderer now takes a direction's Player colours (baked houses), ring colours and a badge over each pawn
(Seat number / shape / initial).
