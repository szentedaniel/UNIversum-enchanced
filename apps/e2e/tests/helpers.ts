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
import { PLAYBACK_MS } from "@universum/rules";
import type { FullPhase, FullView } from "./test-hooks.ts";

/** A screen the spec acts through: a phone taps, a desktop clicks. */
export type Interactor = { page: Page; mobile: boolean };

/** Creates a 2-Player Room on `page`, fills it with a second Guest and starts. */
export async function startGame(
  page: Page,
  browser: Browser,
): Promise<{ context: BrowserContext; guest: Page }> {
  registerPage("creator", page);
  await page.goto("/create");
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const context = await browser.newContext({ locale: "en-US" });
  const guest = await context.newPage();
  registerPage("guest", guest);
  await guest.goto(`/room/${code}`);
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  // The test hooks appear once each screen's Board is up.
  await Promise.all(
    [page, guest].map((screen) =>
      expect
        .poll(() => screen.evaluate(() => window.universumTest?.camera().scale ?? 0))
        .toBeGreaterThan(0),
    ),
  );
  return { context, guest };
}

/** A control the view offers: waits for it to be enabled, then taps or clicks it. */
export async function press(actor: Interactor, target: Locator): Promise<void> {
  await expect(target).toBeEnabled({ timeout: 15_000 });
  if (actor.mobile) await target.tap();
  else await target.click();
}

/** The Player's Fields, cheapest Bank sale value first (Auto-sell's order). */
export function ownFields(view: FullView, player: string): number[] {
  return view.fields
    .map((field, id) => ({ field, id }))
    .filter(({ field }) => field.owner === player)
    .toSorted((a, b) => a.field.sale - b.field.sale || a.id - b.id)
    .map(({ id }) => id);
}

/**
 * Taps a Field through the test-only `fieldCenter` hook and waits until the
 * pick took effect. The Board's Playback must be over first: the dice and a
 * Chance card overlay the Board for their own steps, and the last hop can
 * still be drawing. A tap right after a layout change can miss (#26), so a
 * miss retries with a fresh Field centre.
 */
export async function tapField(actor: Interactor, field: number): Promise<void> {
  await expect(async () => {
    await expect
      .poll(() => actor.page.evaluate(() => window.universumTest?.playback().over ?? false), {
        timeout: PLAYBACK_MS.CardDrawn,
      })
      .toBe(true);
    // Two frames: the Board's queue draws its last hop on the frame after the gate.
    await actor.page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
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

export type OfferPhase = Extract<FullPhase, { kind: "offer" }>;
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
  | null;

/**
 * Resolves the decision the view is at through the controls it offers: an
 * offer (choosing through `chooseOffer`), a Doubler or Erasmus pick, or a Sale.
 * Returns once the controls were used; the caller waits for the server's
 * answer. Every control appears only once its Playback ends (ADR-0004), so
 * Playwright's auto-wait is what waits it out.
 */
export async function resolveDecision(
  actor: Interactor,
  view: FullView,
  chooseOffer: (phase: OfferPhase) => OfferChoice,
): Promise<DecisionResult> {
  const { phase } = view;
  switch (phase.kind) {
    case "offer": {
      const panel = actor.page.getByTestId("offer");
      await expect(panel).toBeVisible();
      const choice = chooseOffer(phase);
      if (choice === "level") {
        const level = phase.levels?.[0];
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
    case "quarantineChoice":
    case "gameOver":
      return null;
  }
  return null;
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
  rejection: { code: string; seq: number } | null;
  /** The latest push: its `seq`, the server clock offset and the event types, in order. */
  push: { seq: number; clockOffset: number; events: string[] } | null;
  /** The pushed view's Turn, current Player, phase, gate and version. */
  view: {
    turn: number;
    currentPlayer: string;
    phase: FullPhase;
    actsAfter: number;
    version: number;
  } | null;
  /** `universumTest.playback()`: the push the gate is for, whether it is open, and the shown Turn. */
  playback: {
    seq: number | null;
    over: boolean;
    shownTurn: { turn: number; currentPlayer: string } | null;
  } | null;
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
 * Registers a page for the failure dump under `name` (the attachment's name);
 * registering the same name again replaces the page, e.g. after a reopen.
 */
export function registerPage(name: string, page: Page): void {
  registeredPages.set(name, page);
}

/**
 * Hands a browser or context to the test, which closes it after the failure
 * dump. A spec that closes its own pages first leaves the dump with an error
 * record instead of that screen's state.
 */
export function closeAfterDump(resource: Browser | BrowserContext): void {
  handedOver.push(resource);
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
 * The `test` every game spec imports instead of `@playwright/test`. On failure
 * it attaches each registered page's state before the pages close (`page` is a
 * dependency, so this teardown runs first); a passing test attaches nothing.
 * `timeout` keeps the dump running even when the test itself timed out.
 */
export const test = base.extend<{ failureDump: void }>({
  failureDump: [
    async ({ page: _page }, use, testInfo) => {
      registeredPages = new Map();
      handedOver = [];
      await use();
      try {
        if (testInfo.status !== testInfo.expectedStatus) await attachDumps(testInfo);
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
