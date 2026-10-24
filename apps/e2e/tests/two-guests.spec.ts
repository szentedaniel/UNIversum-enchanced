import { chromium, devices, expect, webkit, type Page } from "@playwright/test";
import type { PublicView } from "@universum/rules";
import {
  closeAfterDump,
  expectBoardUp,
  fieldCenter,
  press as pressControl,
  registerPage,
  resolveDecision as resolveSharedDecision,
  ROLL_PLAYBACK_MS,
  test,
  type Interactor,
  type OfferChoice,
  type OfferPhase,
} from "./helpers.ts";

const viewOf = (page: Page) => page.evaluate(() => window.universumTest?.view() ?? null);

/** The latest push's view, with every phase's options; `view()` is the view the Board last drew. */
const pushView = (page: Page): Promise<PublicView | null> =>
  page.evaluate(() => window.universumTest?.room().push?.view ?? null);

const me = (page: Page) => page.evaluate(() => window.universumTest?.room().me ?? null);

/**
 * Samples every animation frame (ADR-0004): whether a control for the pushed
 * decision is on screen, and how the client's server clock compares to the
 * push's `actsAfter`. Sampling in the page catches the hold however slow
 * Playwright is to round-trip.
 */
async function startPlaybackProbe(page: Page) {
  await page.evaluate(() => {
    const samples: NonNullable<Window["playbackProbe"]> = [];
    window.playbackProbe = samples;
    let running = true;
    window.stopPlaybackProbe = () => {
      running = false;
    };
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- must live in the page
    const button = (pattern: RegExp) =>
      [...document.querySelectorAll("button")].some((element) =>
        pattern.test(element.textContent?.trim() ?? ""),
      );
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- must live in the page
    const tick = () => {
      const { push, me: viewer } = window.universumTest!.room();
      const diceBox = document.querySelector('[data-testid="dice"]')?.getBoundingClientRect();
      if (push) {
        const { view } = push;
        const decision =
          (view.currentPlayer === viewer &&
            (view.phase.kind === "awaitingRoll" || view.phase.kind === "quarantineChoice") &&
            button(/^Roll/)) ||
          (view.phase.kind === "offer" &&
            document.querySelector('[data-testid="offer"]') !== null) ||
          (view.phase.kind === "selling" &&
            document.querySelector('[data-testid="sale-tray"]') !== null) ||
          ((view.phase.kind === "placingDoubler" || view.phase.kind === "choosingErasmus") &&
            document.querySelector('[data-testid="pick-tray"]') !== null);
        const ring = document.querySelector<SVGCircleElement>(
          "[aria-current=true] .turn-ring-left",
        );
        const delayMs = ring
          ? Number.parseFloat(getComputedStyle(ring).animationDelay) * 1000
          : Number.NaN;
        samples.push({
          version: view.version,
          now: window.universumTest!.serverNow(),
          actsAfter: view.actsAfter,
          decision,
          open: window.universumTest!.playback().gateOpen,
          dice:
            diceBox !== undefined &&
            diceBox.width > 0 &&
            diceBox.height > 0 &&
            diceBox.bottom > 0 &&
            diceBox.right > 0 &&
            diceBox.top < innerHeight &&
            diceBox.left < innerWidth,
          ringDelayMs: Number.isFinite(delayMs) ? Math.round(delayMs) : null,
        });
      }
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const stopPlaybackProbe = (page: Page) =>
  page.evaluate(() => {
    window.stopPlaybackProbe?.();
    return window.playbackProbe ?? [];
  });

test("two Guests, on desktop Chromium and iPhone WebKit, create, join, start and play", async ({
  baseURL,
}) => {
  const desktopBrowser = await chromium.launch({ args: ["--mute-audio"] });
  const phoneBrowser = await webkit.launch();
  try {
    const desktopContext = await desktopBrowser.newContext({
      ...devices["Desktop Chrome"],
      baseURL,
      locale: "en-US",
    });
    const phoneContext = await phoneBrowser.newContext({
      ...devices["iPhone 15"],
      baseURL,
      locale: "en-US",
    });
    const desktop = await desktopContext.newPage();
    const phone = await phoneContext.newPage();
    registerPage("desktop", desktop);
    registerPage("phone", phone);
    // Count dice-sound plays before any app code runs: unlock once, then one per roll.
    await phone.addInitScript(() => {
      window.dicePlays = 0;
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must live in the page
      HTMLMediaElement.prototype.play = function play() {
        window.dicePlays = (window.dicePlays ?? 0) + 1;
        return Promise.resolve();
      };
    });
    const both = [desktop, phone];

    // The desktop Guest creates a 2-Player Room and lands in its Lobby.
    await desktop.goto("/");
    await desktop.getByRole("link", { name: "Create Room" }).click();
    await expect(desktop).toHaveURL("/create");
    await desktop.getByLabel("2", { exact: true }).check();
    await desktop.getByRole("button", { name: "Create Room" }).click();
    await expect(desktop).toHaveURL(/\/room\/[1-9]\d{5}$/);
    const code = new URL(desktop.url()).pathname.split("/").at(-1) ?? "";
    await expect(desktop.getByText("Players: 1/2")).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Start" })).toBeDisabled();

    // The phone Guest joins by the Room code; both see the Seats fill.
    await phone.goto("/");
    await phone.getByRole("textbox", { name: "Room code" }).fill(code);
    await phone.getByRole("button", { name: "Join" }).tap();
    await expect(phone).toHaveURL(`/room/${code}`);
    await Promise.all(both.map((page) => expect(page.getByText("Players: 2/2")).toBeVisible()));

    // Any Player may start a full Lobby.
    await phone.getByRole("button", { name: "Start" }).tap();
    await Promise.all(both.map((page) => expect(page).toHaveURL(`/game/${code}`)));
    await expect(desktop.getByText("Your Turn")).toBeVisible();
    // The Playback probe reads the Board's hooks from the first frame, and this
    // spec's phone is a freshly launched WebKit, whose first Board is the slow one.
    await Promise.all(both.map(expectBoardUp));
    // The dice sound was unlocked by the taps above; a roll now plays it.
    const playsBeforeRoll = await phone.evaluate(() => window.dicePlays ?? 0);

    // Every screen shows the one Turn-timer ring, on the current Player's card.
    for (const page of both) {
      const ring = page.getByRole("timer", { name: "Turn timer" });
      // oxlint-disable-next-line no-await-in-loop -- one page after the other
      await expect(ring).toHaveCount(1);
      // oxlint-disable-next-line no-await-in-loop -- one page after the other
      await expect(page.locator("[aria-current=true]").getByRole("timer")).toBeVisible();
    }

    // Turns: the first Seat (the creator) rolls first, then play alternates. The
    // first University offer is bought at Level 1 and the first Museum offer is
    // taken; later offers (and every Buyout) are declined.
    let bought: { field: number; owner: string } | null = null;
    let museum = null as { field: number; owner: string } | null;
    const actor = (page: Page): Interactor => ({ page, mobile: page === phone });
    const press = (page: Page, name: string | RegExp) =>
      pressControl(actor(page), page.getByRole("button", { name }));
    /** After a Roll: neither screen shows the next decision's controls until actsAfter, and it then does. */
    const expectPlaybackHold = async (roller: Page, versionBefore: number) => {
      const view = await pushView(roller);
      const rolledVersion = view?.version ?? 0;
      expect(rolledVersion).toBeGreaterThan(versionBefore);
      const ids = await Promise.all(both.map(me));
      const current = [desktop, phone].find(
        (page) => ids[[desktop, phone].indexOf(page)] === view?.currentPlayer,
      );
      if (!current) throw new Error("no screen holds the current Player's Seat");
      // Both screens past the Playback by the server's clock.
      await expect
        .poll(
          async () =>
            (
              await Promise.all(
                both.map((page) =>
                  page.evaluate(() => {
                    const { push } = window.universumTest!.room();
                    return push === null
                      ? false
                      : window.universumTest!.serverNow() >= push.view.actsAfter + 100;
                  }),
                ),
              )
            ).every(Boolean),
          // One poll interval past the Playback: the roll can be a 7 s Chance card.
          { timeout: ROLL_PLAYBACK_MS + 1_000 },
        )
        .toBe(true);
      for (const samples of await Promise.all(both.map(stopPlaybackProbe))) {
        const held = samples.filter(
          (sample) => sample.version === rolledVersion && sample.now < sample.actsAfter - 25,
        );
        expect(held.length).toBeGreaterThan(0);
        expect(held.filter((sample) => sample.decision)).toEqual([]);
        // The ring waits full: its animation starts only when the Playback ends.
        expect(held.some((sample) => (sample.ringDelayMs ?? 0) > 100)).toBe(true);
        // Every screen saw the Roll's dice before the pawn moved.
        expect(held.some((sample) => sample.dice)).toBe(true);
      }
      // The decision's control appears once the Playback ends, by auto-wait.
      const phase = view?.phase.kind;
      if (phase === "offer") await expect(current.getByTestId("offer")).toBeVisible();
      else if (phase === "selling") await expect(current.getByTestId("sale-tray")).toBeVisible();
      else if (phase === "placingDoubler" || phase === "choosingErasmus")
        await expect(current.getByTestId("pick-tray")).toBeVisible();
      else if (phase === "quarantineChoice")
        await expect(current.getByRole("button", { name: "Roll for 12" })).toBeVisible();
      else await expect(current.getByRole("button", { name: /^Roll/ })).toBeVisible();
    };

    /** The offer this spec takes: the first University and the first Museum, then Decline. */
    const takeOffer = (phase: OfferPhase): OfferChoice => {
      if (!bought && phase.levels.length > 0) return "level";
      if (!museum && phase.museum !== undefined) return "museum";
      return "decline";
    };

    /**
     * Resolves the decision a Roll stopped at through the controls the view
     * offers. Every control appears only once its Playback ends (ADR-0004), so
     * Playwright's auto-wait is what waits it out.
     */
    const resolveDecision = async (roller: Page, view: PublicView) => {
      const [waiter] = roller === desktop ? [phone] : [desktop];
      const { phase } = view;
      if (phase.kind === "offer") {
        await expect(roller.getByTestId("offer")).toBeVisible();
        await expect(waiter.getByTestId("offer")).toHaveCount(0);
        const choice = takeOffer(phase);
        if (choice === "decline" && phase.buyout !== undefined) {
          await expect(roller.getByRole("button", { name: /^Buy out · / })).toBeVisible();
        }
        const result = await resolveSharedDecision(actor(roller), view, () => choice);
        if (result?.kind === "buy") {
          const taken = { field: result.field, owner: result.owner };
          if (result.choice === "level") bought = taken;
          else museum = taken;
        }
        return;
      }
      if (phase.kind === "quarantineChoice") {
        await press(roller, "Roll for 12");
        return;
      }
      await resolveSharedDecision(actor(roller), view, takeOffer);
    };

    const playTurn = async (turn: number, checkHold = false) => {
      const [roller, waiter] = turn % 2 === 1 ? [desktop, phone] : [phone, desktop];
      await expect(waiter.getByRole("button", { name: "Roll" })).toHaveCount(0);
      const versionBefore = (await pushView(roller))?.version ?? 0;
      if (checkHold) await Promise.all(both.map(startPlaybackProbe));
      // Not `exact`: a Player who landed on Quarantine gets "Roll for 12"
      // instead, which also ends the Turn (or, on a 12, may stop at a decision).
      await press(roller, "Roll");
      // The Roll's own push: the Turn ended, or a decision it set off opened.
      await expect
        .poll(async () => (await pushView(roller))?.version ?? -1)
        .toBeGreaterThan(versionBefore);
      if (checkHold) await expectPlaybackHold(roller, versionBefore);

      // A Roll can stop at more than one decision in a Turn (a pick, then the
      // offer its travel leads to; a Sale, then a Buyout): resolve each until
      // the Turn passes.
      let view = await pushView(roller);
      for (let guard = 0; guard < 6 && view && view.turn === turn; guard++) {
        if (view.phase.kind === "awaitingRoll" || view.phase.kind === "gameOver") break;
        const version = view.version;
        // oxlint-disable-next-line no-await-in-loop -- decisions of one Turn, in order
        await resolveDecision(roller, view);
        // oxlint-disable-next-line no-await-in-loop -- the answer to the last decision
        await expect
          .poll(async () => (await pushView(roller))?.version ?? -1)
          .toBeGreaterThan(version);
        // oxlint-disable-next-line no-await-in-loop -- the push after the last decision
        view = await pushView(roller);
      }
      await Promise.all(
        both.map((page) => expect.poll(async () => (await pushView(page))?.turn).toBe(turn + 1)),
      );
    };
    // At least 4 Turns, and on until someone has bought a University.
    for (let turn = 1; turn <= 16; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- Turns are played one after another
      await playTurn(turn, turn === 1);
      if (turn === 1) {
        // oxlint-disable-next-line no-await-in-loop -- after the first roll
        await expect
          .poll(() => phone.evaluate(() => window.dicePlays ?? 0))
          .toBeGreaterThan(playsBeforeRoll);
      }
      if (turn >= 4 && bought) break;
    }

    // Every client got the same view, and sees the bought University's owner and Level.
    const [desktopView, phoneView] = await Promise.all(both.map(viewOf));
    expect(desktopView).toEqual(phoneView);
    expect(desktopView?.version).toBeGreaterThanOrEqual(4);
    expect(bought).not.toBeNull();
    const { field, owner } = bought!;
    expect(desktopView?.fields[field]).toMatchObject({ owner, level: 1 });
    expect(desktopView?.fields[field]?.value).toBeGreaterThan(0);
    if (museum) {
      expect(desktopView?.fields[museum.field]).toMatchObject({
        owner: museum.owner,
        value: 400_000,
      });
    }

    // Tapping a Field on the Board (found through the test hook) opens its card.
    // The last push's toast can still re-flow the screen and resize the Board,
    // so a tap that misses is retried with a fresh Field centre.
    await expect(async () => {
      const zurich = await fieldCenter(phone, 5);
      await phone.touchscreen.tap(zurich.x, zurich.y);
      await expect(phone.getByTestId("field-card").getByRole("heading")).toHaveText("Zurich", {
        timeout: 1_000,
      });
    }).toPass();

    // The menu muting the dice; the choice is part of the page's storage.
    const phoneId = await me(phone);
    await phone.getByTestId("game-menu").tap();
    await phone.getByTestId("sound-toggle").tap();
    await expect(phone.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");

    // A language switch mid-game reloads the page; the Guest token returns the
    // phone to the same Seat, the game speaks German, and the mute choice survived.
    await phone.getByTestId("language-de").tap();
    await expect(phone.locator("html")).toHaveAttribute("lang", "de");
    await expect(phone).toHaveURL(`/game/${code}`);
    await expect(phone.getByTestId("turn-of")).toBeVisible();
    await expect.poll(() => me(phone)).toBe(phoneId);
    await expect(phone.getByTestId("turn-of")).toContainText(/am Zug/);
    await phone.getByTestId("game-menu").tap();
    await expect(phone.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(phone.getByTestId("sound-toggle")).toContainText("Ton aus");
  } finally {
    closeAfterDump(desktopBrowser, phoneBrowser);
  }
});
