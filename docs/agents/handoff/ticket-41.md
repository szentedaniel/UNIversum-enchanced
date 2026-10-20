# Ticket #41 (language, number formats, sound, old browsers): extension points and gotchas

Branch `ticket/41-language-sound`.

## Text

- **Messages:** `apps/web/messages/{hu,en,de}.json`; every visible app string is a key in all three.
  `apps/web/test/messages.test.ts` fails on a missing/extra key, an empty value, a changed placeholder
  set, or a v1 string that lost its cleaned-up stem; add a row there for each new v1 string. The old-browser
  page is the one exception: its three texts are inline in `index.html` because the module bundle may not
  parse in the browser that needs them.
- After editing messages, run `pnpm --filter @universum/web run paraglide` (also run on install and by the
  Vite plugin). `src/paraglide/` is gitignored; never import it before regenerating.
- **Language:** `#components/LanguagePicker.tsx` (home footer and `#components/GameMenu.tsx`). It calls
  Paraglide `setLocale(locale)`, which persists `PARAGLIDE_LOCALE` and **reloads the page**; `/game/:code`
  then rejoins the Seat by Guest token. Keep the strategy order (`localStorage`, `preferredLanguage`,
  `baseLocale`) in sync in `vite.config.ts` and the `paraglide` script in `apps/web/package.json`; no URL
  strategy, so the address never carries a language. `test/language.test.ts` locks the detection order.
- **Money:** use `formatMoney` (cards, panels, toasts, Player cards: full) or `formatCompactMoney` (Board
  tile notes and the pick/sale tray: compact) from `#text.ts`. Both call `Intl.NumberFormat(getLocale(), …)`;
  never format money anywhere else. `test/money.test.ts` pins hu/en/de grouping and "Ft".
- Dynamic maps (`FIELD_NAMES`, `REJECTIONS`, `CHANCE_CARD_TEXTS`, names, Field kinds) live in `#text.ts`:
  add a new message function to the matching map, or the id falls back to the raw key.

## Sound

- `#audio.ts`: one `HTMLAudioElement` playing `#assets/sounds/dice.mp3`. `installAudioUnlock()` is called
  from `main.tsx` and starts it silently inside the first `pointerdown`/`keydown` (iOS gesture rule).
  `playDice()` is called by `Game` on any push whose events include `DiceRolled`; it is a no-op when muted.
- `#stores/sound-store.ts`: `muted` from `localStorage["universum.soundMuted"]` ("1"/"0"), toggled by the
  `sound-toggle` button in the in-game menu. It survives the language reload; `test/sound.test.ts` stubs
  `Audio` and `localStorage`.
- E2E counts plays by stubbing `HTMLMediaElement.prototype.play` in an init script
  (`window.dicePlays`), then asserts a roll increments it (see `two-guests.spec.ts`).

## Menu and layout

- `#components/GameMenu.tsx` sits at the end of the Game status row (both layouts). It uses the shadcn
  `Dialog` (`components/ui/dialog.tsx`, Base UI) and the picker. Test ids: `game-menu`, `sound-toggle`,
  `language-hu|en|de`.
- Base UI `DialogTrigger` takes the trigger through `render={<Button …/>}` and its children go inside the
  render element; no `<Dialog>` usage existed before this ticket to copy from.

## Old browsers

- `apps/web/index.html` has an inline classic script **before** the module bundle. It checks a baseline
  slice (`Array.prototype.at`, `Object.hasOwn`, `String.prototype.replaceAll`, `structuredClone`, RegExp
  lookbehind, `color-mix(…)`) and, when unsupported, hides `#root` and shows `#old-browser` with the card
  matching `navigator.language` (hu/en/de, else en). Do not add a check that Firefox 114 fails: `:has()`
  only shipped in Firefox 121, above the Vite 8 target.
- Playwright: `tests/language.spec.ts` breaks `Object.hasOwn` with `addInitScript` and asserts the notice
  and its language; it also covers the home picker and the saved choice across reloads.

## Typecheck gotcha

- `apps/web/tsconfig.node.json` now has `allowJs` (tests import generated Paraglide JS) and `dom` libs
  (tests import browser modules such as `src/audio.ts`). Keep both when touching the test tsconfig.
