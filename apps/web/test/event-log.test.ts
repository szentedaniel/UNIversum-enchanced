import type { GameEvent } from "@universum/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYBACK_MS } from "@universum/rules/playback";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { appendRevealed, emptyLog, LOG_LIMIT, type LogPush } from "#playback/log.ts";
import { eventText } from "#playback/presentation.ts";
import { playbackStore } from "#playback/playback-store.ts";
import { logStore, resetLog } from "#stores/log-store.ts";
import { receivePush, reset } from "#stores/room-store.ts";
import { ROLL, viewOf } from "./playback-fixtures.ts";

// The Event log (#182): the lines of the events the Playback has revealed so
// far, newest last, fixed in the language they were appended in. It is
// client-side history: a reload starts empty, and the log appends across
// pushes itself, once per event, at that event's own Playback step.

const T0 = 1_000;

/** The store wakes a few ms past a boundary; tests advance past that slack. */
const advanceTo = (at: number): void => {
  vi.advanceTimersByTime(at - Date.now());
};

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
});

const pushOf = (events: readonly GameEvent[], seq = 1): LogPush => ({
  seq,
  view: viewOf(),
  events,
});

describe("the Event log's lines", () => {
  it("appends one line per event with text, in the push's order and view", () => {
    inLanguage("en");
    const log = appendRevealed(emptyLog, pushOf(ROLL()), ROLL().length);
    const expected = ROLL()
      .map((event) => eventText(event, viewOf()))
      .filter((text): text is string => text !== null);

    expect(log.lines.map((line) => line.text)).toEqual(expected);
    expect(log.lines.map((line) => [line.seq, line.index])).toEqual([
      [1, 0],
      [1, 2],
    ]);
  });

  it("appends a line only once its Playback step has been reached", () => {
    inLanguage("en");
    const push = pushOf(ROLL());

    expect(appendRevealed(emptyLog, push, 0).lines).toEqual([]);
    expect(appendRevealed(emptyLog, push, 1).lines.map((line) => line.index)).toEqual([0]);
    // The walk has no line, so reaching it adds nothing.
    expect(appendRevealed(emptyLog, push, 2).lines.map((line) => line.index)).toEqual([0]);
    expect(appendRevealed(emptyLog, push, 3).lines.map((line) => line.index)).toEqual([0, 2]);
    expect(appendRevealed(emptyLog, push, 4).lines.map((line) => line.index)).toEqual([0, 2]);
  });

  it("appends nothing when the same push is read again", () => {
    inLanguage("en");
    const first = appendRevealed(emptyLog, pushOf(ROLL()), 3);
    const again = appendRevealed(first, pushOf(ROLL()), 3);
    // A stale frame that has reached fewer events must not rewind the cursor
    // and make the log duplicate the lines on its next read.
    const older = appendRevealed(first, pushOf(ROLL()), 1);

    expect(again).toBe(first);
    expect(older).toBe(first);
  });

  it("keeps the lines of the previous pushes when a new push adds its own", () => {
    inLanguage("en");
    const first = appendRevealed(emptyLog, pushOf(ROLL(), 1), 3);
    const second = appendRevealed(first, pushOf(ROLL(), 2), 1);

    expect(second.lines.map((line) => [line.seq, line.index])).toEqual([
      [1, 0],
      [1, 2],
      [2, 0],
    ]);
  });

  it("a push with no events adds no line", () => {
    const log = appendRevealed(emptyLog, pushOf([], 7), 0);

    expect(log.lines).toEqual([]);
    expect(log.cursor).toEqual({ seq: 7, shown: 0 });
  });

  it("keeps only the newest lines, so a long game cannot grow without bound", () => {
    inLanguage("en");
    const events: GameEvent[] = Array.from({ length: LOG_LIMIT + 20 }, (_, index) => ({
      type: "DiceRolled",
      player: "p1",
      dice: [index % 6, (index + 1) % 6],
    }));
    const log = appendRevealed(emptyLog, pushOf(events), events.length);

    expect(log.lines).toHaveLength(LOG_LIMIT);
    expect(log.lines[0]?.index).toBe(20);
    expect(log.lines.at(-1)?.index).toBe(events.length - 1);
  });
});

describe("the Event log store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    reset();
    resetLog();
    inLanguage("en");
  });

  afterEach(() => {
    reset();
    vi.useRealTimers();
  });

  it("adds each line when its Playback step starts, never ahead of the Board", () => {
    receivePush(
      { view: viewOf(undefined, { actsAfter: 60_000 }), events: ROLL(), reveals: [], now: T0 },
      T0,
    );

    expect(logStore.getState().lines.map((line) => line.index)).toEqual([0]);

    const walkEnd = PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved;
    advanceTo(T0 + walkEnd - 1);
    expect(logStore.getState().lines.map((line) => line.index)).toEqual([0]);

    advanceTo(T0 + walkEnd + 20);
    expect(logStore.getState().lines.map((line) => line.index)).toEqual([0, 2]);
    expect(playbackStore.getState().frame?.eventsReached).toBe(3);
  });

  it("resets with the Room, so leaving or changing Room starts an empty log", () => {
    receivePush({ view: viewOf(), events: ROLL(), reveals: [], now: T0 }, T0);
    expect(logStore.getState().lines.length).toBeGreaterThan(0);

    reset();
    expect(logStore.getState().lines).toEqual([]);
  });
});
