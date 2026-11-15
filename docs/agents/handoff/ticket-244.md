# Ticket #244 (compact sound controls on Home): extension points and gotchas

Branch `agent/issue-244-sound-compact-sound-controls-on-the-home-screen`.

## The compact form

- `#components/SoundToggles.tsx` takes `compact?: boolean` (default `false`). Both forms read
  the same `soundStore` and keep the menu's test ids `sound-toggle` (effects) and `music-toggle`
  (music), so a helper written for either screen works on both; Home and the Game menu are never
  on screen together, which is why the ids may repeat.
- `aria-pressed` keeps its #243 meaning in both forms: the effects button is pressed while the
  cues are **off**, the music button while the music is **on**.
- `compact` renders icon-only `Button size="icon"` (the 48 px round sticker, thumb-sized on a
  phone — `icon-sm` is 36 px and would miss the 44 px tap target spec #184 story 4 uses),
  `variant="plain"`, with the state's label moved to `aria-label` (`sound_on`/`sound_off`,
  `music_on`/`music_off`). Those four messages already existed, so **no message file or Paraglide
  regeneration changed**; a new label would need hu/en/de.
- The compact pair sits in one `<div className="flex flex-wrap items-center justify-center gap-2">`;
  the full form still returns the two buttons as a fragment (the menu's `DialogContent` stacks
  them at full width, labels written out).

## Home

- `#screens/Home.tsx` draws `<LanguagePicker />` and `<SoundToggles compact />` in one
  `mt-2 flex flex-col items-center gap-2` block after `JoinByCode`; the `mt-2` moved from the
  picker's `className` to that block. Nothing else on the screen changed, including the
  `leaveRoom()` mount effect (the toggles need no Room: the store is per browser).
- Layout checked in a real Chromium at 360×640 and 852×393: no horizontal scroll at either size.
  Home keeps its single column, so in landscape (393 px tall) the picker and toggles sit below
  the fold and the page scrolls vertically — the picker already did before this ticket.

## Tests

- `apps/web/test/sound-home.test.ts` renders the screen: `renderToStaticMarkup` of
  `createElement(Home)` inside `createElement(MemoryRouter)` (Home's `Link`s and `JoinByCode`'s
  `useNavigate` need a router; `#connection.ts` imports safely in Node and the mount effect does
  not run on the server renderer), with the `vi.mock("zustand", …)` `useStore` seam from
  `chat-mute.test.ts` so the markup shows the store's live state.
- There is no DOM environment in `apps/web` (no jsdom, no Testing Library), so a click is pinned
  at the store seam the buttons call (`toggleEffectsMuted`/`toggleMusicOn`) plus a fresh
  `vi.resetModules()` import of `#stores/sound-store.ts` for the reload; do not add a DOM harness
  for one button.
- `apps/e2e/tests/two-guests.spec.ts` taps `sound-toggle` inside `game-menu` and asserts its
  **text** (`Ton aus`): that is the full form. The compact Home buttons carry no text, so a spec
  that reads their label must go through `aria-label` / `toHaveAccessibleName`.
