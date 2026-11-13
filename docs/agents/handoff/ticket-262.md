# Ticket #262 (Mobile viewport, safe area and overscroll): extension points for later tickets

Branch `agent/issue-262-mobile-viewport-safe-area-and-overscroll-fixes-acr`. Parent: spec #184 (mobile polish and PWA); this ticket owns the viewport meta line, the safe-area utilities and screen padding. The Decision tray and Player card phone layouts are the later mobile tickets and build on these utilities.

## Viewport (`apps/web/index.html`)

- The viewport meta is `width=device-width, initial-scale=1.0, viewport-fit=cover`. It does not set `maximum-scale` or `user-scalable=no`: pinch-zoom stays available on every non-Board screen. Page zoom over the Board is suppressed by `touch-action`, not by the meta.

## Safe-area utilities (`apps/web/src/styles.css`)

- Four functional utilities, one per side family: `pt-safe-<n>`, `pb-safe-<n>`, `px-safe-<n>`, `p-safe-<n>`.
- `<n>` is the screen's own spacing in Tailwind spacing units; the generated declaration is `max(<n> * var(--spacing), env(safe-area-inset-…))`. `0` gives the inset alone (`max(0px, env(…))`) for a shell whose children already space themselves. Examples in use: `pt-safe-10` (Home, `md:pt-safe-16`), `pb-safe-8` (Home, Lobby, Lobby list, Create), `pt-safe-5` (ScreenHeader), `p-safe-4` (error and loading screens, Podium, ReconnectOverlay), `px-safe-0`/`p-safe-0` (the Game shell).
- Do not write `env(safe-area-inset-*)` in a screen or component; add or reuse a utility. `env()` returns 0 where the device reserves no space, so each utility equals its design spacing on a normal screen.
- Top safe padding lives on `ScreenHeader` for Lobby, Lobby list and Create; Home and Game pad their own `main`. The bottom padding is on the outer `min-h-dvh` container (or the Game shell).
- A `fixed inset-0` element leaves its parent's padding behind, so it must pad itself: `Podium` and `ReconnectOverlay` use `p-safe-4`. Check this for any new full-screen overlay or portal.

## Overscroll and touch (`apps/web/src/styles.css`)

- `html, body { overscroll-behavior: none }`; the Game shell also has `.game-shell { overscroll-behavior: none; touch-action: manipulation }`. `manipulation` keeps one-finger scrolling of the Decision tray's checklist and pinch-zoom, while dropping double-tap page zoom.
- `.board` and `.board canvas` both set `touch-action: none`: `board/gestures.ts` owns pan, pinch and wheel, so a one-finger drag on the Board never scrolls or pull-to-refreshes the page. Do not put `touch-action: none` on the whole Game shell: the tray's `max-h-44 overflow-y-auto` checklist must keep scrolling.
- No second breakpoint was added; `wide` is unchanged. The phone Game layout still uses the existing `landscape:` variants.

## Focused fields and the on-screen keyboard

- `apps/web/src/lib/safe-area.ts` exports `fieldVisible(field, area, margin = FIELD_MARGIN)`: whether `window.visualViewport` (whose `offsetTop` is relative to the layout viewport) shows the whole field. `apps/web/test/safe-area.test.ts` pins it.
- `App.tsx` listens for `focusin` (next animation frame) and `visualViewport.resize`, and calls `scrollIntoView({ block: "center", inline: "nearest" })` only when `fieldVisible` is false. The resize listener is what catches the keyboard opening after the focus; most browsers already scroll a field on focus themselves.

## Board fit area

- The Game shell's padding shrinks the Board's wrapper: wide uses `inset-x-[110px] top-[110px] bottom-[200px]`, phone uses `[--board-inset-*]`. The camera still fits `.board-fit-area` inside it, and `fieldCenter`/`pawn` e2e hooks report the canvas's real viewport pixels, so no Board code changed. A future ticket that changes the wrapper's padding must re-check that the Board fits and that `fieldCenter` taps land.

Read for: #184's remaining mobile polish tickets (Decision tray and Player card layouts), any viewport meta, safe-area, overscroll, touch-action or full-screen overlay change.
