import { expect } from "@playwright/test";
import { closeAfterDump, dumpPage, ROLL_PLAYBACK_MS, startGame, test } from "./helpers.ts";

// The failure dump (#54): when a test fails, the shared fixture attaches one
// JSON per registered page — the state that screen held — so a multi-browser
// failure can be diagnosed from the report instead of a temporary patch. The
// fixture attaches only for a failed test, so this spec proves what the
// attachments hold: a live page's game state, and an unreadable page's error
// instead of a throw.
test.use({ locale: "en-US" });

test("a dump carries the screen's room, view, playback and buttons", async ({ page, browser }) => {
  const { context } = await startGame(page, browser);
  try {
    const room = await page.evaluate(() => window.universumTest!.room());
    // Roll is the creator's first decision; its control appears once the
    // Push's Playback ends (ADR-0004), so the poll gets the longest Roll
    // Playback rather than Playwright's 5 s default.
    await expect
      .poll(async () => (await dumpPage("creator", page)).buttons, { timeout: ROLL_PLAYBACK_MS })
      .toContain("Roll");

    const dump = await dumpPage("creator", page);
    expect(dump.name).toBe("creator");
    expect(dump.url).toMatch(/\/game\/[1-9]\d{5}$/);
    expect(dump.error).toBeUndefined();
    expect(typeof dump.now).toBe("number");
    expect(dump.player).toBe(room.me);
    expect(dump.status).toBe("connected");
    expect(dump.rejection).toBeNull();
    expect(dump.push).toEqual({
      seq: room.push!.seq,
      clockOffset: room.push!.clockOffset,
      events: [],
    });
    expect(dump.view).toEqual({
      turn: 1,
      currentPlayer: room.me,
      phase: { kind: "awaitingRoll" },
      actsAfter: room.push!.view.actsAfter,
      version: room.push!.view.version,
    });
    expect(dump.playback).toEqual({
      seq: room.push!.seq,
      over: true,
      shownTurn: { turn: 1, currentPlayer: room.me },
    });
    // The labels are there for a failure where the phase is not the whole story.
    expect(dump.buttons).toContain("Roll");
  } finally {
    closeAfterDump(context);
  }
});

test("a page without the game hooks or already closed becomes an error record, never a throw", async ({
  page,
}) => {
  const blank = await dumpPage("blank", page);
  expect(blank.error).toMatch(/hooks/);
  expect(typeof blank.now).toBe("number");
  expect(blank.buttons).toEqual([]);
  expect(blank.player).toBeNull();

  await page.close();
  const closed = await dumpPage("closed", page);
  expect(closed.error).toMatch(/closed/);
  expect(closed.player).toBeNull();
  expect(closed.push).toBeNull();
  expect(closed.view).toBeNull();
  expect(closed.playback).toBeNull();
});
