# Research: UI, client state & i18n

Ticket: #8 (part of map #1). Researched on **2026-10-18**. Every version number and size below is as of that date. Check them again before implementation.

## Question

Which UI component approach, client-side state model and i18n library fit a v2 game client whose game state the server pushes (ADR-0001: the server owns the game rules; clients send intents and render the state they get)? The client must work on mobile and desktop browsers, ship hu/en/de, and is free to change the visual design.

## What v1 does today (baseline)

- **UI:** three component kits plus extras. `@mui/material` 5, `@mantine/core` 4, `@themesberg/flowbite` 1 (a Tailwind plugin), `@headlessui/react`, `react-modal` and `react-hot-toast`, on top of Tailwind 3 (`client/package.json`). Mantine is imported in 8 places, MUI in 6, Headless UI and react-modal in 2 each (grep of `client/src`).
- **State:** Redux Toolkit 1.7. `gameStateSlice.js` is 1,338 lines and holds both the **rules** and the **UI flags** (`showBuyPanel`, `showCard`, `singleSelecting`, `selectedFields`, …) in one slice (`client/src/Store/slices/gameStateSlice.js`). Under ADR-0001 the rules move to the server, so most of this slice does not carry over.
- **i18n:** i18next 21 loads `/assets/i18n/translations/{lng}.json` over HTTP (`client/src/i18n.js`). There are only **9 keys**, in `hu` and `en`. No German JSON exists, and `CreateLobbyComponent/i18n/de.js` is empty. `<LangSelector />` is commented out in `App.jsx`. Field names and chance-card texts are hard-coded Hungarian in `gameConfig.js` (e.g. `title: 'Negatív PCR teszt'`). **So in practice v1 is not translated.** v2 has to extract every string, and German has to be written from scratch.

## Method for bundle sizes

I measured every size myself: esbuild 0.28.2, `--bundle --minify --format=esm`, `NODE_ENV=production`, with `react`/`react-dom` external, then `gzip -9`, on Node 26.11. Each entry imports a realistic set for this game. "Overlay set" means a dialog + button + text field + select + tooltip. "Dialog only" means a dialog + button. These are small-app numbers: shared internals (Floating UI, focus trap) are paid once, so the cost per extra component goes down. Versions are the npm `latest` dist-tags on 2026-10-18 [npm].

---

## Area 1: UI component approach

### Options

1. **Tailwind v4 + shadcn/ui on Base UI.** shadcn/ui is not a dependency. Components are "copied into your project, and the code is yours" [shadcn-changelog]. Since July 2026 new projects use Base UI by default, and "Radix is still fully supported" [shadcn-baseui-default]. Base UI is "unstyled, accessible" and tree-shakable [baseui-qs]. Setup needs `isolation: isolate` on the root, and on iOS 26+ Safari `position: relative` on `body` so dialog backdrops work after scrolling [baseui-qs]. That is a mobile detail worth knowing early.
2. **Tailwind v4 + shadcn/ui on Radix.** Same model, with the unified `radix-ui` package (1.8.1) [shadcn-changelog-radix]. Every new shadcn component ships for both bases [shadcn-baseui-default].
3. **Tailwind v4 + shadcn/ui on React Aria.** Added as a third base in July 2026 [shadcn-react-aria]. React Aria's `usePress` "handles press interactions across mouse, touch, keyboard, and screen readers", and it cancels a press when the user scrolls [react-aria-usepress]. That is the strongest touch story of the three, but it is the newest base in shadcn.
4. **Mantine.** Note that the ticket says v8, but the current major is **v9** (9.7.3). v9.0 shipped on 2026-03-31 and needs React 19.2+ [mantine-9]. It is a full kit (forms, modals, notifications, hooks). Its responsive tools include breakpoints, responsive style props, `hiddenFrom`/`visibleFrom` and container queries [mantine-responsive]. Its CSS can be imported per component instead of the full `styles.css` [mantine-css].
5. **MUI** (9.5.0). Listed for completeness, since v1 uses it. It comes with Emotion and the heaviest runtime in the table below, and v2 is free to change the visual design anyway.

Tailwind v4 needs Chrome 111, Safari 16.4 and Firefox 128 or newer, because "the core functionality of the framework specifically depends on these browser versions" [tw-compat]. It is mobile-first: "Tailwind uses a mobile-first breakpoint system" [tw-responsive]. v1 already uses Tailwind (v3), so styling knowledge carries over.

### Comparison

| Option                     | JS, dialog only (min / gzip) | JS, overlay set (min / gzip) | CSS                                                                          | Type safety                                  | Mobile fit                                                           |
| -------------------------- | ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| shadcn + **Base UI** 1.9.0 | 70 KB / **24 KB**            | 189 KB / **65 KB**           | Tailwind: only the classes you use                                           | TS-first; component source lives in the repo | Good. Touch-aware primitives; needs the iOS backdrop fix [baseui-qs] |
| shadcn + **Radix** 1.8.1   | 42 KB / **14 KB**            | 108 KB / **36 KB**           | Tailwind: only the classes you use                                           | TS-first; component source lives in the repo | Good. Mature                                                         |
| shadcn + **React Aria**    | not measured                 | not measured                 | Tailwind                                                                     | TS-first                                     | Best touch normalization [react-aria-usepress]                       |
| **Mantine** 9.7.3          | 104 KB / **32 KB**           | 210 KB / **66 KB**           | full `styles.css` = 41 KB gzip; per-component subset ≈ 10 KB gzip (measured) | TS-first                                     | Good. Responsive props, `hiddenFrom` [mantine-responsive]            |
| **MUI** 9.5.0              | 152 KB / **51 KB**           | 251 KB / **82 KB**           | CSS-in-JS (Emotion) at runtime                                               | TS-first                                     | OK. Heaviest                                                         |

Reading the table: Radix is the smallest. Base UI costs about 10 KB gzip more for a dialog and about 29 KB more for the overlay set. Mantine's JS is close to Base UI's, but you also ship its CSS. The UI layer of this game is a few overlays on top of a PixiJS canvas (buy panel, chance card, quarantine, Erasmus, doubler, sell, tax, winner, plus the Lobby forms and lists). It does not need a large kit.

---

## Area 2: Client state (server-pushed game state + local UI state)

Under ADR-0001 the client holds two kinds of state:

- **Game state:** a read-only copy of what the server last pushed for the Room (Players, Fields, money, whose turn, game clock). The client never computes it; it replaces or patches it when an event arrives.
- **Local UI state:** which panel is open, Field selection mode (v1's `singleSelecting`, `selectedFields`), animation progress, the language, a pending-intent spinner.

The PixiJS Board also has to read game state **outside React's render cycle** (in ticker callbacks), so a store that can be read without React matters.

### Options

1. **Zustand 5.0.15.** `createStore` from `zustand/vanilla` returns `getState`, `setState`, `subscribe` and `getInitialState`, and React binds to it with `useStore` and a selector [zustand-createstore]. "The subscribe function allows components to bind to a state-portion without forcing re-render on changes" (transient updates), and the core works without React [zustand-readme]. That fits the Pixi ticker reading state. Typed with the curried `create<T>()(…)` [zustand-ts]. It has a Redux DevTools middleware [zustand-readme].
2. **Redux Toolkit 2.13 + react-redux 9.3.** "Redux Toolkit is written in TypeScript"; `RootState`/`AppDispatch` are inferred; needs TS 5.4+ [rtk-ts]. RTK Query's `onCacheEntryAdded` + `updateCachedData` (Immer drafts) handles streaming over websockets, and the docs name "real-time multiplayer games" as a fit [rtk-streaming]. It continues v1. The cost: v1's reducers were mostly rules, and those move to the server, so the client would keep a lot of Redux setup for little logic.
3. **TanStack Query 5.104.** A request/response cache. Its maintainer's guidance for websockets is to _invalidate_ queries on events and set `staleTime: Infinity`, and he prefers that to `setQueryData` patching, which "doesn't handle addition or deletion, and TypeScript won't like it very much" [tkdodo-ws]. Invalidation means a refetch on every push, which is the wrong shape for a stream of game events. It is useful at most for request-style data such as a public Room list.
4. **Jotai 3.0.1.** Atom-based and small. Atoms are a good model for scattered UI flags. A whole server snapshot is less natural, but `atom` + `useAtom` works.
5. **None (React + `useSyncExternalStore`).** React says to prefer `useState`/`useReducer`, and that `useSyncExternalStore` "is mostly useful if you need to integrate with existing non-React code". Snapshots must be immutable or cached [react-usese]. That means hand-writing what Zustand already gives in 0.4 KB.

### Comparison

| Option                           | JS (min / gzip)     | Type safety                   | Server-push fit                                    | Readable outside React (Pixi ticker)                      | Mobile fit |
| -------------------------------- | ------------------- | ----------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ---------- |
| **Zustand** 5.0.15               | 0.7 KB / **0.4 KB** | Good (`create<T>()`)          | Good: `setState(snapshot)` from the socket handler | Yes: vanilla `getState`/`subscribe` [zustand-createstore] | Excellent  |
| **RTK + react-redux** 2.13 / 9.3 | 27 KB / **10.6 KB** | Excellent (inferred, TS 5.4+) | Good: RTK Query streaming [rtk-streaming]          | Yes: `store.getState()`                                   | Good       |
| **TanStack Query** 5.104         | 33 KB / **10 KB**   | Good                          | Poor for event streams [tkdodo-ws]                 | Via `queryClient.getQueryData`                            | Good       |
| **Jotai** 3.0.1                  | 7.5 KB / **3.3 KB** | Good                          | Fair                                               | Through a store object                                    | Excellent  |
| **None**                         | 0 KB                | As good as you write it       | Hand-written                                       | Hand-written                                              | Excellent  |

Whatever the library, type safety for pushed state comes from **typed transport events**. For example, Socket.IO types the client as `Socket<ServerToClientEvents, ClientToServerEvents>` [socketio-ts]. The best result is one shared TypeScript type for the Room snapshot, used by the server and the client.

---

## Area 3: i18n for hu/en/de

### Options

1. **i18next 26.5.2 + react-i18next 17.1.0.** This continues v1. Since v24, `Intl` is mandatory and only TS 5+ is supported [i18next-migration]. Keys are type-checked through `CustomTypeOptions` and `resources`. Interpolation values are inferred **only** when resources are written in a TS file with `as const` or as a (generated) `.d.ts`: "JSON files don't support `as const`" [i18next-ts]. Large resources can slow `tsc` down; the docs suggest `enableSelector: 'optimize'` [i18next-ts]. A language switch re-renders in place, because `bindI18n` defaults to `'languageChanged'` [react-i18next-opts]. `useTranslation` suspends while resources load [react-i18next-hook]. `i18n.t` also works outside React, e.g. for Pixi text.
2. **Lingui 6.10.0.** ICU MessageFormat. Messages are "compiled at build time by a Babel or SWC plugin", with a Vite plugin. Message IDs "are generated from the source text. You never name a key" [lingui-intro]. Workflow is `lingui extract` (reports missing translations per language) and then `lingui compile`. `--strict` fails the build when translations are missing; `--typescript` emits typed catalogs [lingui-cli]. Switching locale at runtime is `i18n.load` + `i18n.activate`, without a page navigation [lingui-dynamic]. Cost: the build depends on the macro plugin (`@lingui/vite-plugin` peers on Vite 6–8 and Babel/Rolldown [npm]). Type safety comes from macros that check placeholders, not from typed keys.
3. **Paraglide JS 2.29.0 (inlang).** A compiler that turns messages into "typed ESM functions" which bundlers tree-shake. "Typos become compile errors." It claims "up to 70% smaller i18n bundle sizes … (e.g. 47 KB vs 205 KB for 5 locales and 200 messages)" [paraglide-home]; that is a vendor benchmark. I compiled a 3-locale (hu/en/de) project: each message becomes a function with typed inputs (`{ name: NonNullable<unknown> }`) and a `locale?: "hu" | "en" | "de"` option, and holds all three translations inline. The functions do not need React, so they work in Pixi text as well. **Caveat:** by default `setLocale()` "performs a full document navigation or reload". `setLocale(locale, { reload: false })` exists, but the docs discourage it except in narrow cases [paraglide-strategy]. Built-in locale strategies: cookie, localStorage, preferredLanguage, url, globalVariable, baseLocale [paraglide-strategy].

### Comparison

| Option                                  | Runtime JS (min / gzip)                                           | Message payload                                         | Type safety                                                                      | Switch language mid-game                    | Mobile fit          |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- | ------------------- |
| **i18next + react-i18next** 26.5 / 17.1 | 51 KB / **17.1 KB**                                               | JSON per locale, loaded at runtime                      | Keys yes; params only with TS/`.d.ts` resources [i18next-ts]                     | In place (re-render)                        | OK. Largest runtime |
| **Lingui** 6.10                         | 7.8 KB / **3.3 KB**                                               | Compiled catalog per locale, lazy                       | Placeholders checked by macros; `--strict` for missing translations [lingui-cli] | In place [lingui-dynamic]                   | Good                |
| **Paraglide JS** 2.29                   | runtime + 3 messages × 3 locales: 11.4 KB / **4.2 KB** (measured) | Tree-shaken functions; all 3 locales inline per message | Strongest: typed keys **and** params, errors at compile time [paraglide-home]    | Full reload by default [paraglide-strategy] | Good                |

With 3 fixed locales, Paraglide's "all locales inline per message" costs little. With 20 locales it would.

---

## Recommended combination

**Tailwind v4 + shadcn/ui (Base UI) · Zustand (vanilla stores) · Paraglide JS.** If the grilling ticket wants language switching inside a running game, swap Paraglide for **Lingui**.

- **UI: Tailwind v4 + shadcn/ui on Base UI.** One styling system instead of v1's three kits. The components live in the repo, which suits a visual design that is free to change. It is mobile-first, and the team already knows Tailwind. The overlays this game needs are few.
  _Trade-offs:_ Base UI measured about 10–29 KB gzip heavier than Radix for the same components. Radix is a valid alternative with the same shadcn API [shadcn-baseui-default]. Copied-in components are code the project maintains. The iOS 26 backdrop fix is required [baseui-qs]. Mantine v9 is the fallback if the team would rather use a full kit (forms, notifications) than build overlays itself.
- **State: Zustand.**
  - A `roomStore` holds the last server snapshot of the Room. Only the socket layer writes to it, with `setState(snapshot)` or a patch, and it is the single entry point for pushed state.
  - A separate `uiStore` (or plain `useState`) holds panel and Field-selection state.
  - Pixi Board code reads `roomStore.getState()` and `subscribe`s without re-rendering React [zustand-createstore][zustand-readme].
  - Panels such as the buy panel are **derived from the server state** (e.g. "it is my turn and I stand on an unowned Field"), not stored as `show*` flags like in v1.

  _Trade-offs:_ there is less structure than in Redux, so the team has to keep the "only the socket writes `roomStore`" rule by convention. RTK is still a sound choice if the team values the Redux DevTools workflow and RTK Query streaming [rtk-streaming], at about 10 KB gzip more.

- **i18n: Paraglide JS.** It has the strongest type safety (keys and params checked at compile time) and a small runtime, and its message functions work in both React and Pixi. v1 has almost no translations to migrate (9 keys), so staying on i18next gains little.

  _Trade-offs:_
  - A language switch reloads the page by default [paraglide-strategy]. That is acceptable only if the language selector lives outside the Room (home screen or Lobby), or if a reload mid-game just triggers the reconnect that v2 needs anyway.
  - It is a compiler step in the build.
  - If in-place switching is required, use Lingui (in-place `activate`, `--strict` missing-translation checks, also small) [lingui-dynamic][lingui-cli].
  - i18next stays the safe, best-known choice, at about 17 KB gzip and with weaker type safety on JSON [i18next-ts].

Estimated JS on top of React for this whole stack: Base UI overlay set about 65 KB + Zustand 0.4 KB + Paraglide about 4 KB ≈ **70 KB gzip**. The Radix variant is about 40 KB. For comparison, current versions of v1's libraries (MUI + Mantine + i18next + RTK) come to roughly 110–175 KB gzip by the same measures (dialog only to overlay set).

## Open questions for the grilling ticket (#11)

1. **Where does the language selector live**, and must the language change during a running game without a reload? This decides Paraglide versus Lingui.
2. **Who writes the German** (and checks the Hungarian and English)? v1 has no German, so every string has to be extracted and translated as part of reaching parity.
3. **Field names and chance-card texts:** are they client-side translations keyed by Field id / card id, while the server sends only ids and numbers? Or does the server send localized text? The recommendation assumes ids and client-side text.
4. **Event messages from the server** (e.g. "Player X bought Field Y"): do they go out as a code plus params, which the client formats with the typed message functions?
5. **Base UI or Radix** under shadcn: is about 10–30 KB gzip worth the more active primitive library, or does mobile weight win? React Aria is a third option if touch behaviour turns out to be a problem.
6. **Snapshot or patches:** does the server push a full Room snapshot per event, or diffs? This affects the `roomStore` write API and ties to the transport research.
7. **Optimistic UI:** does the client ever show an intent's result before the server confirms it (e.g. the dice animation), or does it always wait? Optimistic UI needs local "pending" state that is reconciled against the next push.
8. **Locale detection order:** saved choice → `navigator.language` → `hu` fallback (v1 falls back to `hu`)?

## Sources

- [npm] npm registry, `https://registry.npmjs.org/<package>` dist-tags and `time`, read 2026-10-18 (react 19.3.1, tailwindcss 4.3.3, shadcn 4.22.0, @base-ui/react 1.9.0, radix-ui 1.8.1, @mantine/core 9.7.3, @mui/material 9.5.0, zustand 5.0.15, @reduxjs/toolkit 2.13.0, react-redux 9.3.0, @tanstack/react-query 5.104.4, jotai 3.0.1, i18next 26.5.2, react-i18next 17.1.0, @lingui/core 6.10.0, @inlang/paraglide-js 2.29.0, @pixi/react 8.0.5, socket.io-client 4.8.4, @lingui/vite-plugin 6.10.0 peers).
- [shadcn-changelog] shadcn/ui changelog: https://ui.shadcn.com/docs/changelog
- [shadcn-baseui-default] July 2026, Base UI as the default: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- [shadcn-changelog-radix] February 2026, Unified Radix UI package: https://ui.shadcn.com/docs/changelog/2026-02-radix-ui
- [shadcn-react-aria] July 2026, React Aria: https://ui.shadcn.com/docs/changelog/2026-07-react-aria
- [baseui-qs] Base UI quick start: https://base-ui.com/react/overview/quick-start
- [react-aria-usepress] React Aria `usePress`: https://react-aria.adobe.com/usePress
- [mantine-9] Mantine 9.0.0 changelog: https://mantine.dev/changelog/9-0-0/
- [mantine-responsive] Mantine responsive styles: https://mantine.dev/styles/responsive/
- [mantine-css] Mantine CSS files list: https://mantine.dev/styles/css-files-list/
- [tw-compat] Tailwind CSS compatibility: https://tailwindcss.com/docs/compatibility
- [tw-responsive] Tailwind CSS responsive design: https://tailwindcss.com/docs/responsive-design
- [zustand-createstore] Zustand `createStore`: https://zustand.docs.pmnd.rs/reference/apis/create-store
- [zustand-readme] Zustand README: https://github.com/pmndrs/zustand/blob/main/README.md
- [zustand-ts] Zustand beginner TypeScript guide: https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript
- [rtk-ts] Redux Toolkit, usage with TypeScript: https://redux.js.org/toolkit/usage/usage-with-typescript
- [rtk-streaming] RTK Query streaming updates: https://redux.js.org/toolkit/rtk-query/usage/streaming-updates
- [tkdodo-ws] Dominik Dorfmeister (TanStack Query maintainer), "Using WebSockets with React Query": https://tkdodo.eu/blog/using-web-sockets-with-react-query
- [react-usese] React `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
- [socketio-ts] Socket.IO v4 TypeScript: https://socket.io/docs/v4/typescript/
- [i18next-migration] i18next migration guide: https://www.i18next.com/misc/migration-guide
- [i18next-ts] i18next TypeScript: https://www.i18next.com/overview/typescript
- [react-i18next-opts] react-i18next i18next instance options: https://react.i18next.com/latest/i18next-instance
- [react-i18next-hook] react-i18next `useTranslation`: https://react.i18next.com/latest/usetranslation-hook
- [lingui-intro] Lingui introduction: https://lingui.dev/introduction
- [lingui-cli] Lingui CLI reference: https://lingui.dev/ref/cli
- [lingui-dynamic] Lingui dynamic loading of catalogs: https://lingui.dev/guides/dynamic-loading-catalogs
- [paraglide-home] Paraglide JS: https://paraglidejs.com/
- [paraglide-strategy] Paraglide JS strategy: https://paraglidejs.com/strategy
- v1 code: `client/package.json`, `client/src/i18n.js`, `client/src/Store/`, `client/src/gameConfig.js`, `client/public/assets/i18n/translations/`, `client/src/Components/CreateLobbyComponent/i18n/`, `client/src/Components/App.jsx`.
