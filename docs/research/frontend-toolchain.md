# Research: frontend toolchain & repo tooling

Ticket: #6 (map: #1, UNIversum v2 modernization). Researched 2026-10-18. Every version number and maturity label below is as of that date and comes from the npm registry, release notes or official docs listed under [Sources](#sources).

## Question

What is the 2026 best-practice toolchain for a Vite + React 19 + TypeScript client in a repo that also holds the server and shared code? Areas: build setup, router, lint and format, monorepo tooling, unit and multi-Player end-to-end testing, CI on GitHub Actions.

Constraints from the map (#1) that matter here:

- Feature parity, nothing new. The v1 client has five routes (`/`, `/rooms`, `/create`, `/room/:code`, `/game/:code`) in `client/src/Components/App.jsx`. It already uses `react-router-dom` v6 hooks (`useNavigate`, `useParams`, `useLocation`). It has no tests.
- Budget ≤ ~50 USD/month. The repo is **private**, so GitHub Actions minutes are metered: GitHub Free includes 2,000 minutes/month for private repos. Public repos on standard runners are free [27].
- The rewrite lives in this repo next to v1 (`client/`, `server/`) until v2 reaches parity. The new tooling must ignore the v1 directories.
- Players are Guests, identified anonymously per browser, and can reconnect into a running game. ADR-0001: the server owns the rules, so the client sends intents and renders state. Multi-Player tests therefore need several isolated browsers, one per Guest, plus a way to drop and restore a Guest's connection.
- Responsive web on desktop and mobile.

## Baseline facts (2026-10-18)

| Thing | Current | Note |
|---|---|---|
| Node.js | 24 "Krypton" is LTS and moves to maintenance on 2026-10-20. 26 is Current and **becomes LTS on 2026-10-28** [21] | From Node 27 on there is one major per year, and every major becomes LTS [22] |
| Node type stripping | Stable in 24.12+, on by default since 22.18 [23] | Erasable syntax only, ignores `tsconfig` `paths`, imports need `.ts` extensions, refuses `.ts` under `node_modules` [23] |
| React | 19.3.1 (React 19.3 blog post 2026-09-09) [1][2] | React Compiler 1.0 stable since 2025-10-07 [2] |
| Vite | 8.3.4. Vite 8 (2026-03-12) uses Rolldown as its single bundler [3][4] | Needs Node 20.19+ / 22.12+ [5] |
| `@vitejs/plugin-react` | 6.1.2. Uses Oxc for React Refresh, no Babel [4] | Native (Rust) React Compiler via `compiler: true` is **experimental**. A Babel path through `reactCompilerPreset` exists [6] |
| TypeScript | 7.0.2. TS 7.0 (2026-07-08) is the Go native port, "10x faster" [7][8] | **No stable programmatic API until 7.1** [8]. 6.0 (2026-03-23) is the last JS-based release [7] |
| `create-vite` `react-ts` template | React ^19.3, Vite ^8.3.4, plugin-react ^6.1.2, **TypeScript ~6.0.2, `oxlint` as its lint script** [9] | The official template already defaults to Oxlint, not ESLint |

## Area 1: Vite + React 19 + TypeScript setup

The build tool is not a real choice: CRA is sunset [2] and Vite is the standard. The open questions are the TypeScript major and whether to turn on React Compiler.

| Option | For | Against |
|---|---|---|
| **TypeScript 7.0** | Type-checks about 10x faster [8]. Oxlint's type-aware linting requires TS 7.0+ [16][17], and tsgolint versions track TS 7 releases [17] | No stable compiler API yet, so tools that call the TS API (typescript-eslint, Volar, some loaders) lag behind until 7.1 [8]. typescript-eslint supports only `>=4.8.4 <6.1.0` [12]. Removes `baseUrl`, `moduleResolution: node10`, `target: es5` [8] |
| **TypeScript 6.0** | What `create-vite` ships today [9]. Every tool that calls the TS API works with it | Slower `tsc`. It is the last JS-based line [7], so a move to 7 comes later anyway |
| React Compiler on | Automatic memoization, stable since 1.0 [2]. Oxlint has 22 React Compiler rules [19] | The Rust transform is experimental [6]. The Babel path brings Babel back into the build [6]. It optimises a UI that is not a known bottleneck (parity, nothing new) |

Vite 8 also adds `resolve.tsconfigPaths` [4]. Vite does not type-check, so `tsc -b` (as in the template [9]) or `oxlint --type-check` [17] covers types.

## Area 2: Router

| | React Router 8.4 | TanStack Router 1.170 |
|---|---|---|
| Released | 8.0 on 2026-06-17, 8.4 on 2026-09-15 [10] | 1.170.45 on 2026-10-16 (npm) |
| Modes | Declarative, Data (`createBrowserRouter`, loaders and actions) and Framework (a Vite plugin adding type-safe `href`, typed route modules, code splitting) [11] | Code-based or file-based. With file-based routes, the Vite plugin generates `routeTree.gen.ts` [14] |
| Type safety | Typed params and `href` in Framework mode only [11]. TanStack's own comparison rates it as partial [13] | "100% inferred TypeScript support", typed path and search params [13a] |
| Search params | Plain `URLSearchParams` | Parsed and validated as JSON [13a] |
| Requirements | React ≥ 19.2.7, Node ≥ 22.22, ESM only. `react-router-dom` is removed, so import from `react-router` [10] | Plugin peer is Vite ≥5 to 8, Node ≥ 20.19 (npm). The plugin must come before `@vitejs/plugin-react` [14] |
| Port cost from v1 | Low: v1 already uses v6 hooks, so it is mostly an import rename plus a route object [10] | Medium: new route-definition style and new hook signatures |
| Bias note | — | The comparison table is TanStack's own doc and says it may miss nuances [13] |

Fit for UNIversum: five routes, and nearly all data arrives over the socket rather than from loaders. Router-level data features are mostly unused. The real differentiator is typing `:code` params. Search params are almost unused.

## Area 3: Lint and format

| | Oxlint 1.88 + Oxfmt 0.73 | Biome 2.5 | ESLint 10 + typescript-eslint 8 + Prettier 3 |
|---|---|---|---|
| Maturity | Oxlint stable since 2025-06. Type-aware linting **stable 2026-07-22** (59 of 61 typescript-eslint type-aware rules) [17]. JS plugins **alpha** (2026-03-11) [18]. **Oxfmt beta** (2026-02-24) [20] | Stable. 500+ rules in v2.5 (2026-06-05) [15]. Type-based rules such as `noFloatingPromises` are still **nursery** [15a] | Most mature. ESLint 10 needs flat config only and Node 20.19+/22.13+/24+ [12a] |
| Type-aware | Via tsgolint on TS 7. `--type-check` also reports compiler errors from the same program [17] | Biome's own inference engine. Nursery only [15a] | typescript-eslint. Does **not** support TS 7 [12] |
| React | `react`, `react-hooks`, `jsx-a11y` plugins built in [16]. 22 React Compiler rules [19] | React rules included | `eslint-plugin-react-hooks` 7 and others (npm) |
| Speed | Native. Oxfmt claims 30× Prettier and 3× Biome [20] | Native | Slowest of the three |
| Config | `.oxlintrc.json` or `oxlint.config.ts` [16][17]. `@oxlint/migrate` [16] | One `biome.json` for both lint and format | Two tools, two configs |
| Default in `create-vite` | **Yes** [9] | No | No |

Risk notes: Oxfmt is pre-1.0 beta [20]. Prettier is the fallback with no lock-in, because Oxfmt aims to match Prettier output [20]. With ESLint, type-aware linting forces TS ≤ 6.0 [12].

## Area 4: Monorepo tooling

The v2 repo needs at least a client, a server and a shared package (intent and state types for socket events). v1 `client/` and `server/` stay outside the workspace.

| | pnpm workspaces alone | + Turborepo 2.11 | Vite+ 1.0 (`vp`) |
|---|---|---|---|
| What it adds | `workspace:` protocol, catalogs (one version line per dep) [24][25]. `pnpm -r run` follows the dependency graph by default [26]. `--filter "...[origin/main]"` selects changed packages [26a]. `pnpm deploy` builds a pruned server bundle for Docker [28] | Task graph plus local and remote cache [29]. `turbo prune --docker` [30]. Vercel Remote Cache is **free on all plans** (Hobby fair use 100 GB/month) [31] | One CLI over Vite, Vitest, Oxlint, Oxfmt, Rolldown and tsdown, plus a task runner with a **local** cache [32][33][34]. `vp check` runs format, lint and type-check in one pass [35]. MIT [32] |
| Maturity | pnpm 12 released 2026-08-26 (now 12.14). pnpm 11 still gets patches [24a] | Long-standing | **1.0 released 2026-09-28** (three weeks old) [33]. Remote cache is planned, not shipped [33][34] |
| Cost | Free | Free | Free |
| Fit for 3 packages | Enough. Builds are small, so caching saves little | Worth it only once CI time hurts | Attractive: the same tools this doc recommends anyway. But it is young, and its built-in commands "cannot be changed" [36] |

Shared-package shape: a "Just-in-Time" internal package exports `.ts` source and lets the consumer compile it [37]. Vite handles that for the client. For the server, Node's type stripping is the open point: Node refuses TS under `node_modules` and needs erasable syntax and explicit `.ts` imports [23]. pnpm symlinks workspace packages into `node_modules`, so this needs a prototype check, or a compiled shared package / server bundling step.

## Area 5: Testing (unit and multi-Player end-to-end)

| Layer | Tool | Notes |
|---|---|---|
| Unit: shared and server rules | **Vitest 5.0.5** (5.0 on 2026-09-03) [38][39] | Needs Node ≥ 22.12 and Vite ≥ 6.4. `clearMocks` is on by default. Up to ~50% faster than v4 [39][40] |
| Socket protocol, multi-Player | Vitest + `socket.io-client`. Start a real server and connect several clients in-process [41] | Socket.IO's documented approach: integration tests with a real server, a `waitFor(socket, event)` helper [41]. Cheapest place to test N Players in a Room, intents, broadcasts and reconnects. No browser needed |
| Components | Vitest **Browser Mode** (`@vitest/browser-playwright`, `vitest-browser-react`) or jsdom 30 / happy-dom 21 | Browser Mode runs in a real browser, Playwright is the recommended provider [42]. Vitest 5 adds Trace View [39] |
| E2E, multi-Player | **Playwright 1.64.1** [43] | Several `browser.newContext()` in one test. Each context is isolated (cookies, local and session storage) [44], so **one context = one Guest** |
| Guest reconnect | Playwright | `context.setOffline(true/false)` cuts and restores the network, WebSockets included [45]. Closing a page and opening a new one in the same context keeps the Guest's stored identity [45] |
| Mobile | Playwright device emulation | `devices['iPhone 13']` and others, per project or per context, so one test can mix a desktop and a mobile Guest [46] |
| Starting the stack | Playwright `webServer` array | Starts server and client, waits on URLs, `reuseExistingServer: !process.env.CI` [47] |

Caveat: the isometric Board is a PixiJS canvas, so DOM locators cannot see Fields or tokens. E2E assertions need DOM-visible state, test hooks or screenshots. That choice belongs with the rendering research.

## Area 6: CI on GitHub Actions

| Piece | Current recommendation |
|---|---|
| Actions | `actions/checkout@v7`, `actions/setup-node@v7` (`cache: pnpm`, `node-version-file`), `pnpm/action-setup@v6` (reads `packageManager` / `devEngines.packageManager`) [48][49][50]. Alternative: `pnpm/setup@v3` installs pnpm and Node in one step (pnpm ≥ 11) [51]. With Vite+: `voidzero-dev/setup-vp` [52] |
| Playwright | `npx playwright install --with-deps`. Upload `playwright-report/` with `actions/upload-artifact` and `if: !cancelled()` [53]. `workers: 1` on CI. Do **not** cache browser binaries (restoring takes as long as downloading) [54]. Shard with `--shard` plus blob reports when the suite grows [54][55] |
| Minutes budget | Private repo: 2,000 free min/month [27]. Use `concurrency` with cancel-in-progress, path filters, Chromium plus one mobile device on PRs, and the full browser matrix on `main` only |
| Node version | Pin with `.node-version`. Node 24 now, 26 from 2026-10-28 [21] |

## Recommended combination

1. **Build:** Vite 8 + `@vitejs/plugin-react` 6 + React 19.3 + **TypeScript 7.0**, strict, with the `create-vite` `react-ts` tsconfig layout [9]. React Compiler stays off for parity. Its lint rules can still run.
2. **Router:** **React Router 8** in Data mode (`createBrowserRouter`) on plain Vite. It is the smallest port from v1's v6 hooks, and loaders are mostly unused. The `:code` param can be typed with a small wrapper. TanStack Router is the alternative if fully typed routes are wanted.
3. **Lint/format:** **Oxlint** (react, react-hooks, jsx-a11y, React Compiler rules, `--type-aware --type-check`) + **Oxfmt**. If the Oxfmt beta misbehaves, fall back to Prettier. This is the `create-vite` default [9]. It also needs TS 7, which settles the TS choice.
4. **Monorepo:** **pnpm workspaces + catalogs**. Layout is roughly `apps/web`, `apps/server`, `packages/shared`, with v1 `client/` and `server/` excluded from the workspace, the linter and the formatter. **No Turborepo at the start.** `pnpm -r` plus `--filter "...[origin/main]"` covers three packages. Turborepo or Vite+ can be added when CI time warrants it.
5. **Testing:** Vitest 5 for shared and server units, plus multi-client Socket.IO integration tests (the main multi-Player safety net). Vitest Browser Mode for the few interactive components. Playwright for a thin E2E layer: one context per Guest, a mixed desktop and mobile Room, reconnect via `setOffline` and a page reopen.
6. **CI:** One workflow on PRs and `main`: install → `oxfmt --check` → `oxlint --type-aware --type-check` → `vitest run` → `vite build` → Playwright (Chromium plus one mobile device). Cancel superseded runs.

Trade-offs taken:

- **Young tools.** TS 7 is 3 months old and has no stable API. Oxfmt is beta. Type-aware Oxlint has been stable for 3 months. In exchange: one fast toolchain, no typescript-eslint/TS 7 conflict, and alignment with the official template. Fallbacks: TS 6 + ESLint, Prettier.
- **No task runner.** This costs build caching, which three small packages barely need. A runner can be added later without restructuring.
- **Vite+ not adopted yet.** It bundles exactly these tools, so moving later through `vp migrate` [33] is cheap. Waiting avoids a 3-week-old 1.0 and its fixed built-in commands [36].
- **React Router over TanStack.** This costs end-to-end route typing. It saves porting effort, and an app with five routes, driven by the socket, gains little from TanStack's search-param and loader typing.

## Open questions for the grilling ticket (#11)

1. TS 7 + Oxlint (this recommendation), or TS 6 + ESLint/typescript-eslint for maximum ecosystem compatibility? Is there any tool in the planned stack (i18n type generation, a PixiJS React binding, schema libraries) that needs the TS 7.1 API?
2. Oxfmt (beta) or Prettier/Biome for formatting?
3. React Router 8 Data mode, or TanStack Router for typed routes?
4. Adopt Vite+ now (one CLI, `vp check`, `setup-vp`), or keep the separate tools and revisit after its first minor releases?
5. Workspace layout and names (`apps/web`, `apps/server`, `packages/shared`?), and how v1 `client/` and `server/` are fenced off until removal.
6. Shared package: Just-in-Time `.ts` source (needs server bundling, or confirming Node type stripping across the pnpm symlink) or compiled with `tsc`/tsdown? This depends on the server-runtime research.
7. Node 24 or 26 as the baseline (26 becomes LTS on 2026-10-28)?
8. E2E surface on the canvas Board: DOM mirrors, test hooks exposing state, or screenshot assertions?
9. CI budget: is the repo staying private (2,000 min/month) or going public (free minutes)? That decides how wide the PR browser matrix can be.
10. pnpm 12 (Rust CLI, 2 months old) or pnpm 11?

## Sources

1. npm registry, `react` / `react-dom` dist-tags and publish times, fetched 2026-10-18: https://registry.npmjs.org/react
2. React blog index (React 19.3 2026-09-09, 19.2 2025-10-01, React Compiler v1.0 2025-10-07, Sunsetting Create React App 2025-02-14): https://react.dev/blog
3. Vite blog index (Vite 8 2026-03-12, 8.1 2026-06-23): https://vite.dev/blog/
4. Announcing Vite 8: https://vite.dev/blog/announcing-vite8
5. Vite guide, Node requirement and templates: https://vite.dev/guide/
6. `@vitejs/plugin-react` README, React Compiler section: https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md
7. TypeScript blog index (TS 7.0 2026-07-08, 6.0 2026-03-23): https://devblogs.microsoft.com/typescript/
8. Announcing TypeScript 7.0: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
9. `create-vite` `template-react-ts` (`package.json`, `tsconfig.app.json`): https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts
10. React Router changelog (v8.0.0 to v8.4.0) and npm publish times: https://github.com/remix-run/react-router/blob/main/packages/react-router/CHANGELOG.md
11. React Router, Picking a Mode: https://reactrouter.com/start/modes
12. typescript-eslint, dependency versions: https://typescript-eslint.io/users/dependency-versions/
12a. ESLint, Migrate to v10.x: https://eslint.org/docs/latest/use/migrate-to-10.0.0
13. TanStack Router, comparison: https://tanstack.com/router/latest/docs/framework/react/comparison
13a. TanStack Router, overview: https://tanstack.com/router/latest/docs/framework/react/overview
14. TanStack Router, installation with Vite: https://tanstack.com/router/latest/docs/framework/react/installation/with-vite
15. Biome v2.5 announcement: https://biomejs.dev/blog/biome-v2-5/
15a. Biome rule `noFloatingPromises` (nursery, types domain): https://biomejs.dev/linter/rules/no-floating-promises/
16. Oxlint usage guide: https://oxc.rs/docs/guide/usage/linter.html
17. Oxc blog, "Type-Aware Linting Stable" (2026-07-22), and type-aware docs: https://github.com/oxc-project/oxc-project.github.io/blob/main/src/blog/2026-07-22-type-aware-linting-stable.md, https://oxc.rs/docs/guide/usage/linter/type-aware.html
18. Oxc blog, "Oxlint JS Plugins Alpha" (2026-03-11): https://github.com/oxc-project/oxc-project.github.io/blob/main/src/blog/2026-03-11-oxlint-js-plugins-alpha.md
19. Oxc blog, "React Compiler Support" (2026-08-18): https://github.com/oxc-project/oxc-project.github.io/blob/main/src/blog/2026-08-18-react-compiler-support.md
20. Oxc blog, "Oxfmt Beta" (2026-02-24), and formatter docs: https://github.com/oxc-project/oxc-project.github.io/blob/main/src/blog/2026-02-24-oxfmt-beta.md, https://oxc.rs/docs/guide/usage/formatter.html
21. Node.js release schedule (`schedule.json`): https://github.com/nodejs/Release/blob/main/schedule.json
22. Node.js previous releases (annual cycle from Node 27): https://nodejs.org/en/about/previous-releases
23. Node.js docs, Modules: TypeScript: https://nodejs.org/api/typescript.html
24. pnpm workspaces: https://pnpm.io/workspaces
24a. pnpm releases (v12.0.0 2026-08-26, 12.14.0 and 11.28.6 2026-10-15): https://github.com/pnpm/pnpm/releases
25. pnpm catalogs: https://pnpm.io/catalogs
26. pnpm run (recursive runs use the dependency graph): https://pnpm.io/cli/run
26a. pnpm filtering (`[<since>]`): https://pnpm.io/filtering
27. GitHub Docs, GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
28. pnpm deploy: https://pnpm.io/cli/deploy
29. Turborepo docs: https://turborepo.dev/docs
30. `turbo prune`: https://turborepo.dev/docs/reference/prune
31. Vercel Remote Caching (free on all plans, fair-use limits): https://vercel.com/docs/monorepos/remote-caching
32. Vite+ home: https://viteplus.dev/
33. VoidZero, "Announcing Vite+ 1.0" (2026-09-28), and blog index: https://voidzero.dev/posts/announcing-vite-plus-1-0, https://voidzero.dev/blog
34. Vite+ task caching: https://viteplus.dev/guide/cache
35. Vite+ `vp check`: https://viteplus.dev/guide/check
36. Vite+ guide: https://viteplus.dev/guide/
37. Turborepo, Internal Packages (Just-in-Time vs Compiled): https://turborepo.dev/docs/core-concepts/internal-packages
38. Vitest blog index (5.0 2026-09-03): https://vitest.dev/blog/
39. Announcing Vitest 5.0: https://vitest.dev/blog/vitest-5
40. VoidZero, September 2026 recap: https://voidzero.dev/posts/whats-new-sep-2026
41. Socket.IO docs, Testing: https://socket.io/docs/v4/testing/
42. Vitest Browser Mode: https://vitest.dev/guide/browser/
43. Playwright release notes: https://playwright.dev/docs/release-notes
44. Playwright, Isolation / browser contexts (multi-user): https://playwright.dev/docs/browser-contexts
45. Playwright API, BrowserContext (`setOffline`, `storageState`, `close`): https://playwright.dev/docs/api/class-browsercontext
46. Playwright, Emulation: https://playwright.dev/docs/emulation
47. Playwright, Web server: https://playwright.dev/docs/test-webserver
48. `actions/setup-node` README and advanced usage (pnpm cache example): https://github.com/actions/setup-node, https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md
49. `actions/checkout` releases (v7.0.1): https://github.com/actions/checkout/releases
50. `pnpm/action-setup` README (v6.1.0): https://github.com/pnpm/action-setup
51. `pnpm/setup` README: https://github.com/pnpm/setup
52. `voidzero-dev/setup-vp` README: https://github.com/voidzero-dev/setup-vp
53. Playwright, Setting up CI: https://playwright.dev/docs/ci-intro
54. Playwright, Continuous Integration: https://playwright.dev/docs/ci
55. Playwright, Sharding: https://playwright.dev/docs/test-sharding

Package versions without a numbered source (oxlint 1.88.0, oxfmt 0.73.0, turbo 2.11.9, @tanstack/react-router 1.170.45, @playwright/test 1.64.1, jsdom 30.1.3, happy-dom 21.0.3, eslint-plugin-react-hooks 7.1.1) come from the npm registry `dist-tags.latest`, fetched 2026-10-18 (`https://registry.npmjs.org/<package>`).
