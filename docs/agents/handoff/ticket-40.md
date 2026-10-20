# Ticket #40 (Tabletop visual direction): extension points for later tickets

Branch `ticket/40-tabletop`. Tailwind v4 + shadcn/ui (base-nova, on Base UI `@base-ui/react` 1.9.0) + lucide-react + @fontsource.

## Theme (`apps/web/src/styles.css`)

- One CSS file. Tokens are on `:root` (light) and `@media (prefers-color-scheme: dark) { :root {…} }` (dark), with shadcn names plus `success/warning/danger`, `ink` (#2b2238), `board-backdrop`, `--radius: 18px`. Tailwind classes: `bg-card text-card-foreground`, `bg-primary`, `text-muted-foreground`, `text-ink/70`, `bg-danger`, `rounded-ui` (= 18px), `font-display` (Sigmar One), and `font-sans` (Nunito, the body default).
- Utilities: `sticker` (3px border + 4px shadow), `sticker-sm` (2.5px + 2px, for small controls), `press` (moves into its shadow on :active), `tnum`, `board-backdrop`, `logo-outline(-sm)`, `pop-in`. Keyframes: `confetti` (for #32's podium).
- Variant `wide:` = `(min-width: 48rem) and (orientation: landscape)`. JS twin: `useWide()` / `useMediaQuery()` in `src/lib/use-media-query.ts`.
- `test/theme.test.ts` parses styles.css and asserts the spec token table, the backdrop gradients, the sticker sizes and WCAG AA. **If you rename the `:root` blocks or `@utility sticker`, update that test.**
- Gotcha: tailwind-merge (`cn`) treats unknown `text-*` classes as colours, so a custom utility named `text-foo` would delete `text-primary`. Don't give custom utilities a `text-`/`bg-`/`border-` prefix.
- Gotcha: the `sticker` utility sorts after `border-*` colour/width utilities. To override its border, use the important suffix (`border-primary! border-4!`), as PlayerCard does.
- Fonts: `@fontsource/sigmar-one/latin.css` + `latin-ext.css`, and `@fontsource-variable/nunito/wght.css`. They are imported in styles.css, which Vite fingerprints, so they're self-hosted. Pixi Board text still uses system-ui. #38 can switch to `"Nunito Variable"`, but it must wait for `document.fonts.load` first.

## Player looks (`src/players.ts`)

- `playerLook(seat) → { color, shape, figure }`: colours `#f29db6 #8db5e7 #70c4a8 #ffcc00`, shapes `● ▲ ■ ★`, alien PNG URLs. `INK`. `board/colors.ts` keeps its numeric `PLAYER_COLORS`, and `test/players.test.ts` keeps them equal.
- Board pawn badge: `board/badge.ts` `pawnBadge(seat)` (Player-colour disc + drawn shape, not text). It's one line in `board.ts` `syncPawns`, placed at `(0,-32)` above the pawn. **#38: keep adding it over the alien sprites.**

## Components

- shadcn (copied from the `base-nova` registry, then restyled; no `components.json`, because the repo uses `#` subpath imports, not `@/`): `components/ui/button.tsx` (variants `default|plain|accent|secondary|danger`; sizes `default|sm|lg|icon|icon-sm`; **`size="icon"` = the round sticker camera button**; `buttonVariants` works on `<Link>`), `card.tsx`, `input.tsx`, `label.tsx`, `toggle-group.tsx` (chunky segmented: Players 2/3/4, Minute limit; Base UI value is an array of strings), `dialog.tsx` (password prompt, #36). To add more: `curl https://ui.shadcn.com/r/styles/base-nova/<name>.json`, replace `cn` → `#lib/utils.ts`, and restyle with sticker classes.
- App components (`components/`): `Logo` (h1, or `small` = `<p>`), `RoomCodeInput` (Base UI OTPField, 6 boxes; the first box is labelled "Room code", the others "Digit N"; **e2e: `getByRole("textbox", { name: "Room code" }).fill(code)`**, because `getByLabel` also hits the group), `PlayerToken` / `PlayerFigure` (alien on a cream disc), `TimerRing` (Player-colour ring + figure, with a `ring` slot for #25's `screens/TurnRing.tsx`, which is passed as `PlayerSummary.ring` on the current Player; the `.turn-ring*` CSS is in styles.css `@layer components`, stroked in primary and exempt from reduced motion; e2e finds the current Player by `[aria-current=true]`), `SeatCard` (fixed 4-Seat size, `open`, `creator` crown, `you`, `held` ReactNode for #35's "Reconnecting… 0:42"), `PlayerCard` (desktop corner) and `PlayerChip` (phone), both from a `PlayerSummary`, and `MinutePill` (from `view.endsAt`) / `EventToast` (`tone` neutral|good|bad) in `GameHud.tsx`.
- No Lobby-tile component exists. #36 can build Lobby tiles from `Card` + `PlayerToken`/`PlayerFigure` + `Button` (prototype `dirB.tsx` `LobbyListB`: 1/2/3 columns `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, Full = `opacity-60` + disabled button).

## Screens (restyled, logic unchanged)

- Home: Logo, `Button size="lg"` Create Room, sticker form with `RoomCodeInput` + accent Join.
- Lobby: back link + small logo, "Lobby" h1, Room-code sticker button (aria-label "Copy the Room code", testid `room-code`, clipboard → "Copied"), `<ul>` of SeatCards (**creator = Seat 0**: the server sends no creator flag; if #35/#36 add one, use it), settings strip, full-width Start.
- Game, `useWide()`: **Board fit area = the absolutely positioned wrapper `inset-x-[110px] top-[110px] bottom-[200px]`** around `<Board/>` (`.board` host fills it; `[data-testid=board]` box). Corner PlayerCards (`CORNERS[seat]`: TL, TR, BR, BL), status row (MinutePill + EventToast) at `top-6`, bottom-centre card `w-[min(440px,calc(100%-600px))]`. **#38: to go full-bleed with a camera, make the canvas fill the screen and use that wrapper's rect as the fit area. Put the round camera buttons at `absolute right-4 top-1/2 -translate-y-1/2`, stacked `Button variant="plain" size="icon"`.**
- Game, phone: flex column: chips row, status row, Board (`flex-1`), card. The bottom card is a `Card` with turn-of + selected Field + Roll. #38's Field card and #39's tray replace or extend it.
- One toast at a time: the first describable event of a push (previously up to 2 joined with " · ").

## Tests

- `test/theme.test.ts`, `test/players.test.ts`, `test/wcag.ts` (`contrast(a,b)`).
- `apps/e2e/tests/tabletop.spec.ts` (single-browser projects): OS scheme → body background, self-hosted fonts loaded, digit boxes, Lobby Seat cards / crown / copy sticker, game layout (desktop corner cards, larger current card, phone chips, pill above the Board). Uses testids `seat`, `player-card`, `player-chip`, `minute-pill`, `toast`, `board`.
- Lint: `react-perf/jsx-no-new-object-as-prop` is off for web (runtime `style={{…}}` colours).
