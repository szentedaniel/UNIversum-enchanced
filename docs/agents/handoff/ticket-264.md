# Ticket #264 (Mobile: Decision tray and Player card phone layouts): extension points for later tickets

Branch `agent/issue-264-mobile-decision-tray-and-player-card-phone-layouts`, parent spec #184 (mobile polish and PWA). Builds on #262's safe-area utilities and `dvh` screens. Presentation only: no rules, timing, numbers or protocol changed; the Decision fence still reads the Sale or pick through `decision/decision.ts` only.

## The layout helper (`apps/web/src/lib/tray-layout.ts`)

- `CARD_RESERVE_PX` is 224 (14rem), the space `Game.tsx`'s phone layout reserves at the Board's bottom (`[--board-inset-bottom:14rem]` on the Board's wrapper). The two must stay equal.
- `cardMaxHeight(viewportHeight, keyboard = 0)` gives the bottom card's ceiling in px: `min(224, floor((height - keyboard) * 0.45))`, floored at 0. At 360×640 it is 224 (the Board's reserve); at 852×393 it is 176; a 300 px keyboard on 640 leaves 153.
- `keyboardInset(layoutHeight, visual)` is the px the on-screen keyboard covers at the bottom (`layoutHeight - visual.height - visual.offsetTop`, rounded); it is 0 without a visual viewport and when `visual.scale > 1`, because a pinch-zoomed viewport is not a keyboard.
- `useCardLayout()` returns `{ width, keyboard, maxHeight }`, updated on `window`'s `resize` and `visualViewport`'s `resize`/`scroll`. It is the module's one React hook; the vitest file imports only the pure exports.
- `chipWidth(viewportWidth, players)` divides the strip (its own `px-2` 16 px plus 6 px gaps) and `stripMoney(viewportWidth, players)` answers `"full"` or `"compact"`: below 100 px per chip the full cash line does not fit, so the chips show `PlayerSummary.cashShort` (`formatCompactMoney`). Tests: `apps/web/test/tray-layout.test.ts`, 16 cases over fixed viewports (360×640, 390, 852×393, 320) and 2/3/4 Players.

## Game screen (`apps/web/src/screens/Game.tsx`)

- The phone branch's one bottom-card wrapper is `absolute inset-x-2 bottom-0 overflow-y-auto overscroll-contain pb-1 pr-1 landscape:mx-auto landscape:max-w-md` with `style={{ bottom: keyboard, maxHeight }}` from `useCardLayout`. It scrolls any card taller than the budget (the tray, the Turn card, the Field card); the padding keeps the `sticker` shadow out of the clip.
- The ceiling equals the Board's 14rem reserve on a portrait phone, so the camera's fit area is unchanged: at 360×640 the `.board-fit-area` bottom and the wrapper top were both y = 408. Changing `CARD_RESERVE_PX` or the `[--board-inset-bottom:14rem]` class without the other shifts that fit.
- Safe area: the shell's `pt-safe-2`/`pb-safe-2` keep the strip and the card clear of the insets; the wrapper's inline `bottom` adds the keyboard on top of that padding.
- `openCard` state (a Seat or `null`): the phone strip renders one `PlayerChip` per Player, and the open Seat's full `PlayerCard` (`w-full max-w-sm scale-100`) replaces the chips. The wide branch is untouched (corner `PlayerCard`s, no chips, no collapse button).
- `compactMoney` is `stripMoney(cardLayout.width, players.length) === "compact"`; the expanded card always shows the full amount.

## PlayerCard (`apps/web/src/components/PlayerCard.tsx`)

- `PlayerCard` takes an optional `onCollapse`; it renders the 44 px `X` button (`m.game_hide_card()`). Only the phone strip passes it, so the wide corner cards' DOM is unchanged.
- `PlayerChip` is a `<li data-testid="player-chip" data-current aria-current>` around a real `<button>` labelled `m.game_show_card({ name })`; the test id and `aria-current` stay on the `li` (e2e reads `[aria-current=true]` and the chip's bounding box). `compactMoney` swaps its cash line to `cashShort`.
- `PlayerSummary` gained `cashShort` beside the unchanged `cash`; a new summary field must be set in `Game.tsx`'s `players` map.

## Tray, Deal and Turn card (`screens/DecisionTray.tsx`, `screens/DealTray.tsx`)

- Tap targets: the two tray icon toggles, the pick chips, the checklist rows, the Deal recipients and Field chips carry `min-h-11 min-w-11`; the Deal cash inputs are `h-11`. Measured at 360×640: toggles 44×44, a pick chip 44 tall, checklist rows 44, Auto-sell/Sell 48.
- The primary actions are `sticky bottom-0` with `bg-card` (Sale's Auto-sell/Sell grid, the pick commit button, the Deal propose and answer rows), so they stay at the wrapper's bottom while a tall tray scrolls. The checklist keeps its own `max-h-44 overflow-y-auto`.
- No test ids changed; the tray root keeps `data-board-obstacle` and its `sticker` classes.

## Messages

- `game_show_card` ("Show {name}'s card" / "{name} játékoskártyájának megnyitása" / "Spielerkarte von {name} anzeigen") and `game_hide_card` ("Collapse the card" / "Játékoskártya összecsukása" / "Spielerkarte einklappen") in `apps/web/messages/{en,hu,de}.json`; Paraglide regenerated.

## Gotchas

- Headless CI cannot open an on-screen keyboard. The lift was smoke-tested in Chromium by overriding `visualViewport.height` and dispatching its `resize` (wrapper moved to `bottom: 300px`, `max-height: 153px`); the phone Playwright smoke of spec #184 still owns the device check.
- The hook measures the layout viewport (`window.innerWidth`); a landscape notch (`px-safe-0`) makes the real strip a few px narrower than `chipWidth` assumes, which only matters at the 100 px boundary.
- The expanded strip card keeps its state across pushes (it shows the live Player); a Seat missing from the view falls back to the chips.
