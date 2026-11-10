/**
 * Shared Playwright behaviour for the specs that act through a game's
 * controls. A phone taps and a desktop clicks, a Board tap waits for the
 * decision gate, and a decision is resolved from the options the view offers;
 * each spec keeps its own assertions and bookkeeping.
 */
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  PLAYBACK_MS,
  playbackOf,
  type ChanceCardId,
  type GameEvent,
  type PhaseOf,
  type PublicView,
} from "@universum/rules";
import type { PlaybackHook, Rejection, SocketCall } from "./test-hooks.ts";

/** A screen the spec acts through: a phone taps, a desktop clicks. */
export type Interactor = { page: Page; mobile: boolean };

/** The Board's camera, from the test-only hook; null before the Board is up. */
const camera = (page: Page) => page.evaluate(() => window.universumTest?.camera() ?? null);

/** The Board's camera scale, 0 before the Board is up. */
export const scale = async (page: Page) => (await camera(page))?.scale ?? 0;

/** A Field's centre on the Board, from the test-only hook. */
export const fieldCenter = (page: Page, id: number) =>
  page.evaluate((field) => window.universumTest!.fieldCenter(field), id);

/**
 * Records every WebSocket the page constructs, before the app's scripts run
 * (#61). A browser rejects the SDK's first attempt — `new WebSocket(url,
 * { headers, protocols })`, the Node form — and only the fallback serves the
 * game, so a page that recorded two constructions threw once. `createAndJoin`
 * installs it for the pages it drives; a hand-rolled flow calls it before the
 * page reaches a Room.
 */
export async function probeSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: SocketCall[] = [];
    window.universumWebSockets = calls;
    class Probe extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        calls.push({ protocols: typeof protocols });
        super(url, protocols);
      }
    }
    window.WebSocket = Probe;
  });
}

/**
 * The longest Playback a Roll's push can carry: the dice, a 12-Field walk, the
 * Chance card drawn on landing, its effect and the Round bonus. Waits after a
 * Playback use its length, not Playwright's 5 s default.
 */
export const ROLL_PLAYBACK_MS = playbackOf([
  { type: "DiceRolled", player: "p1", dice: [6, 6] },
  { type: "Moved", player: "p1", from: 0, to: 12, steps: 12 },
  { type: "CardDrawn", player: "p1", card: "failedExams" },
  { type: "ChanceMoneyReceived", player: "p1", amount: 0 },
  { type: "RoundBonusPaid", player: "p1", amount: 0 },
] satisfies readonly GameEvent[]);

/**
 * Creates a 2-Player Room on `creator` and fills the second Seat with a Guest
 * in a new context. The names are the failure dump's attachment names.
 */
async function createAndJoin(
  creator: Page,
  browser: Browser,
  names: { creator: string; guest: string },
  baseURL?: string,
): Promise<{ code: string; context: BrowserContext; guest: Page }> {
  registerPage(names.creator, creator);
  await probeSockets(creator);
  await creator.goto("/create");
  await creator.getByLabel("2", { exact: true }).check();
  await creator.getByRole("button", { name: "Create Room" }).click();
  await expect(creator).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(creator.url()).pathname.split("/").at(-1) ?? "";
  const context = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    locale: "en-US",
  });
  const guest = await context.newPage();
  registerPage(names.guest, guest);
  await probeSockets(guest);
  await guest.goto(`/room/${code}`);
  return { code, context, guest };
}

/**
 * How long a screen's Board may take to come up: a browser's first Board
 * (WebKit on a Linux runner renders WebGL in software) takes over 5 s.
 */
const BOARD_UP_MS = 15_000;

/** Waits until `page`'s Board is up: its test hooks appear with the Board. */
export async function expectBoardUp(page: Page): Promise<void> {
  await expect.poll(() => scale(page), { timeout: BOARD_UP_MS }).toBeGreaterThan(0);
}

/**
 * A join opens one WebSocket, with the browser signature (#61): a page that
 * recorded two constructions threw on the first, and the throw costs a
 * `pageerror` in WebKit even though the SDK's fallback connects. A page that
 * opened another socket first (the Lobby list) cannot use this count.
 */
export async function expectOneJoinSocket(page: Page, name: string): Promise<void> {
  const calls = await page.evaluate<SocketCall[]>(() => window.universumWebSockets ?? []);
  expect(calls, `${name} opened ${String(calls.length)} WebSockets to join`).toEqual([
    { protocols: "undefined" },
  ] satisfies SocketCall[]);
}

/** Creates a 2-Player Room on `page`, fills it with a second Guest and starts. */
export async function startGame(
  page: Page,
  browser: Browser,
): Promise<{ context: BrowserContext; guest: Page }> {
  const { code, context, guest } = await createAndJoin(page, browser, {
    creator: "creator",
    guest: "guest",
  });
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  await Promise.all([page, guest].map(expectBoardUp));
  await Promise.all([expectOneJoinSocket(page, "creator"), expectOneJoinSocket(guest, "guest")]);
  return { context, guest };
}

/** The creator opens a 2-Player Lobby and a second Guest joins it by code; returns the joiner's page. */
export async function twoInLobby(
  creator: Page,
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ code: string; joiner: Page }> {
  const { code, guest } = await createAndJoin(
    creator,
    browser,
    { creator: "creator", guest: "joiner" },
    baseURL,
  );
  for (const page of [creator, guest]) {
    // oxlint-disable-next-line no-await-in-loop -- one page after the other
    await expect(page.getByText("Players: 2/2")).toBeVisible();
  }
  return { code, joiner: guest };
}

/** A control the view offers: waits for it to be enabled, then taps or clicks it. */
export async function press(actor: Interactor, target: Locator): Promise<void> {
  await expect(target).toBeEnabled({ timeout: 15_000 });
  if (actor.mobile) await target.tap();
  else await target.click();
}

/** The Player cards or chips around the Board, one per Seat: the wide and the phone layout. */
export function playerCards(page: Page): Locator {
  return page.locator('[data-testid="player-card"], [data-testid="player-chip"]');
}

/** The Player's Fields, cheapest Bank sale value first (Auto-sell's order). */
export function ownFields(view: PublicView, player: string): number[] {
  return view.fields
    .map((field, id) => ({ field, id }))
    .filter(({ field }) => field.owner === player)
    .toSorted((a, b) => a.field.sale - b.field.sale || a.id - b.id)
    .map(({ id }) => id);
}

/**
 * Taps a Field through the test-only `fieldCenter` hook and waits until the
 * pick took effect. The Decision gate must be open first: the dice and a
 * Chance card overlay the Board for their own steps, and a tap right after a
 * layout change can miss (#26), so a miss retries with a fresh Field centre.
 */
export async function tapField(actor: Interactor, field: number): Promise<void> {
  await expect(async () => {
    await expect
      .poll(() => actor.page.evaluate(() => window.universumTest?.playback().gateOpen ?? false), {
        timeout: PLAYBACK_MS.CardDrawn,
      })
      .toBe(true);
    const point = await actor.page.evaluate(
      (id) => window.universumTest?.fieldCenter(id) ?? null,
      field,
    );
    if (point === null) throw new Error("the Board is not ready");
    if (actor.mobile) await actor.page.touchscreen.tap(point.x, point.y);
    else await actor.page.mouse.click(point.x, point.y);
    await expect
      .poll(
        () =>
          actor.page.evaluate(
            (id) => window.universumTest?.pick()?.picked.includes(id) ?? false,
            field,
          ),
        { timeout: 1_500 },
      )
      .toBe(true);
  }).toPass({ timeout: 10_000 });
}

/** A Chance card's effect on the Player who drew it; `showChance` fills in `player`. */
export type ChanceEffect = { type: "ChanceMoneyReceived" | "ChanceChargePaid"; amount: number };

/**
 * Shows a made-up push that drew the given Chance card, as if the server had
 * just sent it (#52). The server's clock lets the decision open at once, so
 * only the push's local Playback (the card, 7 s) holds it shut; `effects` are
 * the card's own money events, in order.
 */
export function showChance(
  page: Page,
  card: ChanceCardId,
  effects: readonly ChanceEffect[] = [],
): Promise<void> {
  return page.evaluate(
    ({ drawn, extra }) => {
      const hooks = window.universumTest!;
      const { me, push } = hooks.room();
      const view = structuredClone(push!.view);
      view.actsAfter = hooks.serverNow();
      hooks.showView(view, [
        { type: "CardDrawn", player: me!, card: drawn },
        ...extra.map((effect) => ({ ...effect, player: me! })),
      ]);
    },
    { drawn: card, extra: effects },
  );
}

export type OfferPhase = PhaseOf<"offer">;
export type OfferChoice = "level" | "museum" | "buyout" | "decline";

/** What resolving a decision did, for each spec's bookkeeping. */
export type DecisionResult =
  | {
      kind: "buy";
      choice: Exclude<OfferChoice, "decline">;
      field: number;
      owner: string;
    }
  | { kind: "decline" }
  | { kind: "pick" }
  | { kind: "roll" };

/**
 * Resolves the decision the view is at through the controls it offers: a Roll
 * (or a Quarantine's Roll for 12), an offer (choosing through `chooseOffer`), a
 * Doubler or Erasmus pick, or a Sale. A `gameOver` view has no decision left
 * and throws. Returns once the controls were used; the caller waits for the
 * server's answer. Every control appears only once its Playback ends
 * (ADR-0004), so Playwright's auto-wait is what waits it out.
 */
export async function resolveDecision(
  actor: Interactor,
  view: PublicView,
  chooseOffer: (phase: OfferPhase) => OfferChoice,
): Promise<DecisionResult> {
  const { phase } = view;
  switch (phase.kind) {
    case "offer": {
      const panel = actor.page.getByTestId("offer");
      await expect(panel).toBeVisible();
      const choice = chooseOffer(phase);
      if (choice === "level") {
        const level = phase.levels[0];
        if (level === undefined) throw new Error("the offer has no Level to buy");
        await press(
          actor,
          panel.getByRole("button", { name: new RegExp(`^Level ${level.level} · `) }),
        );
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      if (choice === "museum") {
        await press(actor, panel.getByRole("button", { name: /^Buy · / }));
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      if (choice === "buyout") {
        await press(actor, panel.getByRole("button", { name: /^Buy out · / }));
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      await press(actor, panel.getByRole("button", { name: "Decline", exact: true }));
      return { kind: "decline" };
    }
    case "placingDoubler":
    case "choosingErasmus": {
      const tray = actor.page.getByTestId("pick-tray");
      await expect(tray).toBeVisible();
      const field = phase.fields[0];
      if (field === undefined) throw new Error(`${phase.kind} offered no Field`);
      await tapField(actor, field);
      await press(
        actor,
        phase.kind === "placingDoubler"
          ? tray.getByRole("button", { name: /^Put the Doubler on / })
          : tray.getByRole("button", { name: /^Travel to / }),
      );
      return { kind: "pick" };
    }
    case "selling": {
      const tray = actor.page.getByTestId("sale-tray");
      await expect(tray).toBeVisible();
      const sell = tray.getByRole("button", { name: /^Sell / });
      for (const field of ownFields(view, view.currentPlayer)) {
        // oxlint-disable-next-line no-await-in-loop -- the meter decides the next pick
        if (await sell.isEnabled()) break;
        // oxlint-disable-next-line no-await-in-loop -- one pick at a time updates the meter
        const already = await actor.page.evaluate(
          (id) => window.universumTest?.pick()?.picked.includes(id) ?? false,
          field,
        );
        if (!already) {
          // oxlint-disable-next-line no-await-in-loop -- one pick at a time
          await tapField(actor, field);
        }
      }
      await press(actor, sell);
      return { kind: "pick" };
    }
    case "awaitingRoll":
      await press(actor, actor.page.getByRole("button", { name: "Roll", exact: true }));
      return { kind: "roll" };
    case "quarantineChoice":
      await press(actor, actor.page.getByRole("button", { name: "Roll for 12", exact: true }));
      return { kind: "roll" };
    case "dealAnswer":
      throw new Error("the Deal answer panel is not built yet (#194)");
    case "gameOver":
      throw new Error("the game is over");
    default: {
      const unhandled: never = phase;
      throw new Error(`the view is at an unknown phase ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * One screen's state when a test failed (#54), as the report's attachment
 * carries it. Built from the page's test hooks plus its DOM, so a failure in a
 * multi-browser spec can be read without patching the spec.
 */
export type PageDump = {
  /** The name the spec registered the page under; also the attachment's name. */
  name: string;
  /** The page's URL when the dump ran. */
  url: string;
  /** The page's `Date.now()` when the dump ran. */
  now: number | null;
  /** The Player this client is (`room().me`); null before the game or without hooks. */
  player: string | null;
  /** The connection status (`connected`, `reconnecting`, …). */
  status: string | null;
  /** The latest Rejection of one of this client's intents. */
  rejection: Rejection | null;
  /** The latest push: its `seq`, the server clock offset and the event types, in order. */
  push: { seq: number; clockOffset: number; events: string[] } | null;
  /** The pushed view's Turn, current Player, phase, gate and version. */
  view: Pick<PublicView, "turn" | "currentPlayer" | "phase" | "actsAfter" | "version"> | null;
  /** `universumTest.playback()`: the push the gate is for, whether it is open, and the shown Turn. */
  playback: PlaybackHook | null;
  /** The labels of the buttons on screen when the dump ran. */
  buttons: string[];
  /** Why the page could not be read (closed, navigating, no hooks); the rest is then null. */
  error?: string;
};

/** How long one page may take to answer: a page mid-navigation must not hold the report. */
const DUMP_TIMEOUT_MS = 2_000;

/** Resolves to `null` instead of waiting longer than `ms`; a late rejection is ignored. */
async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([task, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads one page's game state for the failure report. Never throws: a page
 * that is closed, navigating or without the test hooks reports why in `error`,
 * so a dump can never replace the failure it was meant to explain.
 */
export async function dumpPage(name: string, page: Page): Promise<PageDump> {
  const dump: PageDump = {
    name,
    url: page.url(),
    now: null,
    player: null,
    status: null,
    rejection: null,
    push: null,
    view: null,
    playback: null,
    buttons: [],
  };
  if (page.isClosed()) return { ...dump, error: "the page was closed" };
  try {
    const state = await withTimeout(
      page.evaluate((): Partial<Omit<PageDump, "name" | "url">> => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- must live in the page
        const visible = (element: Element): boolean => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none") return false;
          return element.getClientRects().length > 0;
        };
        const buttons = [...document.querySelectorAll("button")]
          .filter((button) => visible(button))
          .map((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim())
          .filter((label) => label.length > 0);
        const now = Date.now();
        const hooks = window.universumTest;
        if (hooks === undefined) return { now, buttons, error: "no game hooks on the page" };
        const { me, status, rejection, push } = hooks.room();
        return {
          now,
          player: me,
          status,
          rejection,
          push:
            push === null
              ? null
              : {
                  seq: push.seq,
                  clockOffset: push.clockOffset,
                  events: push.events.map((event) => event.type),
                },
          view:
            push === null
              ? null
              : {
                  turn: push.view.turn,
                  currentPlayer: push.view.currentPlayer,
                  phase: push.view.phase,
                  actsAfter: push.view.actsAfter,
                  version: push.view.version,
                },
          playback: hooks.playback(),
          buttons,
        };
      }),
      DUMP_TIMEOUT_MS,
    );
    if (state === null) return { ...dump, error: `no answer within ${DUMP_TIMEOUT_MS} ms` };
    return { ...dump, ...state };
  } catch (error) {
    return { ...dump, error: error instanceof Error ? error.message : String(error) };
  }
}

// The pages the current test opened, by name, and the resources it handed to
// the test. Module scope is safe: each spec file runs its tests one at a time
// in one worker, and the fixture below resets both at the start of every test.
let registeredPages = new Map<string, Page>();
let handedOver: (Browser | BrowserContext)[] = [];

/**
 * The uncaught exceptions the browsers reported for the current test (#61).
 * A page's own `error` listeners never saw the SDK's caught `SyntaxError`, but
 * WebKit still reports it as a page error, so the guard fixture fails the test
 * on any of them and the failure dump is attached first.
 */
let pageErrors: { page: Page; error: Error }[] = [];
const watchedPages = new WeakSet<Page>();
/** The name each page is registered under now; the last registration wins. */
const pageNames = new WeakMap<Page, string>();

/**
 * Registers a page for the failure dump under `name` (the attachment's name);
 * registering the same name again replaces the page, e.g. after a reopen, and
 * a page registered under a new name keeps only its latest name — the guard
 * reports its errors under that name too.
 */
export function registerPage(name: string, page: Page): void {
  const previous = pageNames.get(page);
  if (previous !== undefined && previous !== name) registeredPages.delete(previous);
  registeredPages.set(name, page);
  pageNames.set(page, name);
  if (watchedPages.has(page)) return;
  watchedPages.add(page);
  page.on("pageerror", (error) => pageErrors.push({ page, error }));
}

/**
 * Hands browsers or contexts to the test, which closes them after the failure
 * dump. A spec that closes its own pages first leaves the dump with an error
 * record instead of that screen's state.
 */
export function closeAfterDump(...resources: (Browser | BrowserContext)[]): void {
  handedOver.push(...resources);
}

/** One JSON per registered page, each named after it. */
async function attachDumps(testInfo: TestInfo): Promise<void> {
  const dumps = await Promise.all([...registeredPages].map(([name, page]) => dumpPage(name, page)));
  await Promise.all(
    dumps.map((dump) =>
      testInfo.attach(`${dump.name}.json`, {
        body: JSON.stringify(dump, null, 2),
        contentType: "application/json",
      }),
    ),
  );
}

/**
 * The `test` every game spec imports instead of `@playwright/test`: the
 * failure dump (#54) and the `pageerror` guard (#61). `failureDump` depends on
 * the guard, so the guard is set up first and torn down last: a passing test
 * whose page threw gets its dumps attached, then fails with the page's name.
 */
export const test = base.extend<{ failureDump: void; pageErrorGuard: void }>({
  pageErrorGuard: [
    // oxlint-disable-next-line no-empty-pattern -- the guard reads module state, no fixture
    async ({}, use) => {
      pageErrors = [];
      await use();
      if (pageErrors.length === 0) return;
      throw new Error(
        pageErrors
          .map(
            ({ page, error }) =>
              `${pageNames.get(page) ?? "a page"} threw: ${error.stack ?? error.message}`,
          )
          .join("\n\n"),
      );
    },
    { auto: true, timeout: 30_000 },
  ],
  /**
   * On failure, attaches each registered page's state before the pages close
   * (`page` is a dependency, so this teardown runs first) and closes what the
   * spec handed over. A passing test attaches nothing, unless the guard will
   * fail it. `timeout` keeps the teardown running when the test timed out.
   */
  failureDump: [
    async ({ page: _page, pageErrorGuard: _guard }, use, testInfo) => {
      registeredPages = new Map();
      handedOver = [];
      await use();
      const failed = testInfo.status !== testInfo.expectedStatus;
      try {
        if (failed || pageErrors.length > 0) await attachDumps(testInfo);
      } catch (error) {
        // Never let the dump replace the test's own error.
        console.warn(`the failure dump was not attached: ${String(error)}`);
      } finally {
        await Promise.all(
          handedOver.toReversed().map((resource) =>
            resource.close().catch((error: unknown) => {
              console.warn(`a test resource was not closed: ${String(error)}`);
            }),
          ),
        );
      }
    },
    { auto: true, timeout: 30_000 },
  ],
});
