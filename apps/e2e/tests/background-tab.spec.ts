import { expect, type Page } from "@playwright/test";
import { playbackOfEvent, type GameEvent } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { closeAfterDump, startGame, test } from "./helpers.ts";

// A hidden tab throttles animation frames, not clocks (#67, spec #63). The
// Board reads the shared Playback by `Date.now()` on each frame, so the first
// frame after the tab returns already shows the pawn where the Playback is.
// Playwright can't hide a tab, so the frames are parked instead: the page
// keeps its timers (the Playback store's wake-ups) and loses only its render
// loop, which is what Chromium does to a hidden tab's frames.
test.use({ locale: "en-US" });

/** The push this spec makes: one walk of three Fields, so only the walk holds the gate. */
const WALK_STEPS = 3;

/** How long that walk plays: the spec's own budget for waiting out its gate (ADR-0004). */
const WALK_PLAYBACK_MS = playbackOfEvent({
  type: "Moved",
  player: "p1",
  from: 0,
  to: WALK_STEPS,
  steps: WALK_STEPS,
} satisfies GameEvent);

/** Parks every animation frame the page requests, until `resumeBoardFrames`. */
async function starveFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const schedule = window.requestAnimationFrame.bind(window);
    const parked: FrameRequestCallback[] = [];
    // Nothing cancels a parked frame, so one plain id serves them all.
    window.requestAnimationFrame = (callback) => {
      parked.push(callback);
      return 1;
    };
    window.resumeBoardFrames = () => {
      window.requestAnimationFrame = schedule;
      window.resumeBoardFrames = undefined;
      for (const callback of parked.splice(0)) schedule(callback);
    };
  });
}

test("a tab starved of frames puts the pawn where the Playback is on its first frame", async ({
  page,
  browser,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await starveFrames(page);
    // A push that walks the creator three Fields, while no frame can draw it.
    const moved = await page.evaluate(
      ({ fieldCount, steps }) => {
        const hooks = window.universumTest!;
        const { me, push } = hooks.room();
        if (me === null) throw new Error("this client has no Player");
        const view = structuredClone(push!.view);
        const player = view.players.find((candidate) => candidate.id === me);
        if (!player) throw new Error("the view has no Player for this client");
        const from = player.position;
        const to = (from + steps) % fieldCount;
        player.position = to;
        // The decision opens at once on the server's clock: only the walk holds the gate.
        view.actsAfter = hooks.serverNow();
        hooks.showView(view, [{ type: "Moved", player: me, from, to, steps }]);
        return { player: me, to };
      },
      { fieldCount: FIELD_COUNT, steps: WALK_STEPS },
    );
    // The walk runs out while the frames are parked, as it does in a hidden tab.
    // One poll interval past the walk, so the check lands after the store's wake.
    await expect
      .poll(() => page.evaluate(() => window.universumTest!.playback().gateOpen), {
        timeout: WALK_PLAYBACK_MS + 1_000,
      })
      .toBe(true);
    // The tab comes back: one frame, then the pawn must be at the walked Field.
    await page.evaluate(async () => {
      window.resumeBoardFrames!();
      const { promise, resolve } = Promise.withResolvers<number>();
      requestAnimationFrame(resolve);
      await promise;
    });
    const [pawn, centre] = await page.evaluate(({ player, to }) => {
      const hooks = window.universumTest!;
      return [hooks.pawn(player), hooks.fieldCenter(to)];
    }, moved);
    expect(pawn).not.toBeNull();
    expect(pawn!.x).toBeCloseTo(centre.x, 1);
    expect(pawn!.y).toBeCloseTo(centre.y, 1);
  } finally {
    closeAfterDump(context);
  }
});
