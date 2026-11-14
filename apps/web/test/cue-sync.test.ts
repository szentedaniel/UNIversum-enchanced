import type { GameEvent } from "@universum/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentPlayback } from "#playback/playback-store.ts";
import { playbackOfPush } from "#playback/playback.ts";
import { timelineOf } from "#playback/timeline.ts";
import { resetCues, syncCues } from "#sound/cue-sync.ts";
import type { CueName } from "#sound/cues.ts";
import { roomStore } from "#stores/room-store.ts";
import { CHANCE, ROLL, viewOf } from "./playback-fixtures.ts";

const { playCue } = vi.hoisted(() => ({ playCue: vi.fn<(name: CueName) => void>() }));
vi.mock("#audio.ts", () => ({ playCue }));

// The cues follow the Playback frame (spec #178, ADR-0004): a frame names how
// many of the push's events it has reached, and each newly reached event's cue
// plays once, in order. No clock: the frame is the clock.

const dice = (): GameEvent => ({ type: "DiceRolled", player: "p1", dice: [3, 4] });
const move = (): GameEvent => ({ type: "Moved", player: "p1", from: 1, to: 8, steps: 7 });

const push = (seq: number, events: readonly GameEvent[]) => ({ seq, events });
const frame = (seq: number, eventsReached: number) => ({ seq, eventsReached });

beforeEach(() => {
  resetCues();
  playCue.mockClear();
});

describe("the Playback store's cues", () => {
  afterEach(() => {
    roomStore.setState({ push: null });
    vi.useRealTimers();
  });

  it("plays the dice when the frame reaches the roll, not when the push arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    // The roll's step starts after the walk, so the first frame has not reached it.
    roomStore.setState({
      push: {
        view: viewOf(undefined, { actsAfter: 0 }),
        events: [move(), dice()],
        reveals: [],
        seq: 7,
        clockOffset: 0,
        receivedAt: 1_000,
      },
    });

    expect(playCue).not.toHaveBeenCalled();

    const [walkEnds] = currentPlayback()?.boundaries ?? [];
    vi.advanceTimersByTime((walkEnds ?? 0) - 1_000 + 20);

    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("dice");
  });
});

describe("syncCues", () => {
  it("plays a newly reached event's cue once, and a silent event's nothing", () => {
    const events = [move(), dice()];

    syncCues(push(1, events), frame(1, 0));
    expect(playCue).not.toHaveBeenCalled();

    syncCues(push(1, events), frame(1, 1));
    expect(playCue).not.toHaveBeenCalled();

    syncCues(push(1, events), frame(1, 2));
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("dice");

    // The same push read again at the same place: nothing new.
    syncCues(push(1, events), frame(1, 2));
    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("plays every cue a late wake skipped over, in order", () => {
    const events = [dice(), move(), dice()];

    syncCues(push(1, events), frame(1, 3));

    expect(playCue.mock.calls).toEqual([["dice"], ["dice"]]);
  });

  it("plays Rent then a purchase as a push's frame reaches them", () => {
    // A push whose Rent arrives before a purchase: one sound at each event's step.
    const events: GameEvent[] = [
      { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
      { type: "LevelBought", player: "p1", field: 9, level: 1, price: 100_000 },
    ];

    syncCues(push(1, events), frame(1, 0));
    expect(playCue).not.toHaveBeenCalled();

    syncCues(push(1, events), frame(1, 1));
    expect(playCue.mock.calls).toEqual([["rent"]]);

    syncCues(push(1, events), frame(1, 2));
    expect(playCue.mock.calls).toEqual([["rent"], ["buy"]]);
  });

  it("plays the cues of a new push from its start, even after the last one ended", () => {
    syncCues(push(1, [dice()]), frame(1, 1));
    syncCues(push(2, [dice()]), frame(2, 1));

    expect(playCue).toHaveBeenCalledTimes(2);
  });

  it("plays nothing for an older push, a mismatched frame or a reconnect's empty push", () => {
    syncCues(push(2, [dice()]), frame(2, 1));
    expect(playCue).toHaveBeenCalledTimes(1);

    syncCues(push(1, [dice()]), frame(1, 1));
    syncCues(push(5, [dice()]), frame(4, 1));
    syncCues(push(6, []), frame(6, 0));
    syncCues(null, frame(6, 1));
    syncCues(push(6, [dice()]), null);

    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("plays the dice when a real Playback frame first reaches the roll", () => {
    const events = ROLL();
    const core = playbackOfPush({
      view: viewOf(undefined, { actsAfter: 0 }),
      events,
      reveals: [],
      seq: 3,
      clockOffset: 0,
      receivedAt: 1_000,
    });

    // The roll's step starts with the push: the first frame already reached it, once.
    syncCues(push(3, events), core.frameAt(1_000));
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledWith("dice");

    syncCues(push(3, events), core.frameAt(1_000));
    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("plays the card in the frame that opens its overlay, not a moment before", () => {
    const events = CHANCE();
    const core = playbackOfPush({
      view: viewOf(undefined, { actsAfter: 0 }),
      events,
      reveals: [],
      seq: 4,
      clockOffset: 0,
      receivedAt: 1_000,
    });
    const cardStart = timelineOf(events).find((step) => step.kind === "card")?.startMs ?? -1;

    // The roll's step starts with the push: the dice play at once, the card not yet.
    syncCues(push(4, events), core.frameAt(1_000));
    expect(playCue.mock.calls).toEqual([["dice"]]);

    // The walk's last moment: the card's step has not started, so no card.
    syncCues(push(4, events), core.frameAt(1_000 + cardStart - 1));
    expect(playCue.mock.calls).toEqual([["dice"]]);

    // The frame whose overlay is the card plays the card, once.
    const opens = core.frameAt(1_000 + cardStart);
    expect(opens.overlay?.kind).toBe("card");
    syncCues(push(4, events), opens);
    expect(playCue.mock.calls).toEqual([["dice"], ["chance"]]);

    // Reading the same frame again plays nothing more.
    syncCues(push(4, events), core.frameAt(1_000 + cardStart));
    expect(playCue.mock.calls).toEqual([["dice"], ["chance"]]);
  });

  it("plays the card and the Quarantine it sends the Player to, in order", () => {
    // The exam-period card walks the Player to the Quarantine Field and enters it.
    const events: GameEvent[] = [
      { type: "CardDrawn", player: "p1", card: "examPeriod" },
      { type: "Moved", player: "p1", from: 4, to: 16, steps: 12 },
      { type: "QuarantineEntered", player: "p1", rounds: 3 },
    ];

    syncCues(push(1, events), frame(1, 3));

    expect(playCue.mock.calls).toEqual([["chance"], ["quarantine"]]);
  });
});
