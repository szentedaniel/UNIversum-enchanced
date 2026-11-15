import type { GameEvent } from "@universum/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bottomSlot } from "#decision/decision.ts";
import { currentPlayback } from "#playback/playback-store.ts";
import { playbackOfPush } from "#playback/playback.ts";
import { timelineOf } from "#playback/timeline.ts";
import { resetCues, syncCues } from "#sound/cue-sync.ts";
import type { CueName } from "#sound/cues.ts";
import { roomStore } from "#stores/room-store.ts";
import { CHANCE, playersWithCash, ROLL, viewOf } from "./playback-fixtures.ts";

const { playCue } = vi.hoisted(() => ({ playCue: vi.fn<(name: CueName) => void>() }));
vi.mock("#audio.ts", () => ({ playCue }));

// The cues follow the Playback frame (spec #178, ADR-0004): a frame names how
// many of the push's events it has reached, and each newly reached event's cue
// plays once, in order. No clock: the frame is the clock.

const dice = (): GameEvent => ({ type: "DiceRolled", player: "p1", dice: [3, 4] });
const move = (): GameEvent => ({ type: "Moved", player: "p1", from: 1, to: 8, steps: 7 });
const bankrupt = (): GameEvent => ({ type: "WentBankrupt", player: "p1", fields: [3, 4] });
const gameEnded = (): GameEvent => ({ type: "GameEnded", winner: "p2", reason: "lastPlayer" });

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

  it("plays the Chance card in the frame that opens its overlay, not a moment before", () => {
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

  it("plays the Chance card and the Quarantine it sends the Player to, in order", () => {
    // The exam-period Chance card walks the Player to the Quarantine Field and enters it.
    const events: GameEvent[] = [
      { type: "CardDrawn", player: "p1", card: "examPeriod" },
      { type: "Moved", player: "p1", from: 4, to: 16, steps: 12 },
      { type: "QuarantineEntered", player: "p1", rounds: 3 },
    ];

    syncCues(push(1, events), frame(1, 3));

    expect(playCue.mock.calls).toEqual([["chance"], ["quarantine"]]);
  });
});

describe("the game-end cues", () => {
  it("plays bankrupt then gameEnd as one push's frame reaches them", () => {
    const events = [bankrupt(), gameEnded()];

    syncCues(push(1, events), frame(1, 0));
    expect(playCue).not.toHaveBeenCalled();

    syncCues(push(1, events), frame(1, 1));
    expect(playCue.mock.calls).toEqual([["bankrupt"]]);

    syncCues(push(1, events), frame(1, 2));
    expect(playCue.mock.calls).toEqual([["bankrupt"], ["gameEnd"]]);
  });

  it("plays gameEnd at its step, before the podium opens, and not at its frame", () => {
    // The result screen's own view, as the Podium's tests shape it.
    const events = [bankrupt(), gameEnded()];
    const view = viewOf(undefined, {
      phase: { kind: "gameOver", winner: "p2", reason: "lastPlayer" },
      players: playersWithCash({ p1: 0, p2: 900_000 }),
      standings: [
        { player: "p2", wealth: 900_000 },
        { player: "p1", wealth: 0 },
      ],
    });
    const core = playbackOfPush({
      view,
      events,
      reveals: [],
      seq: 5,
      clockOffset: 0,
      receivedAt: 1_000,
    });
    const [, endStep] = timelineOf(events);
    const ui = { selectedField: null, inspect: false };
    const podiumAt = core.boundaries.find(
      (time) => bottomSlot(null, core.frameAt(time), ui).kind === "podium",
    );

    // Bankrupt's step: the first cue, with the result screen still closed.
    syncCues(push(5, events), core.frameAt(1_000));
    expect(playCue.mock.calls).toEqual([["bankrupt"]]);

    // The game's end's step: the closing cue, and the podium is not up yet.
    const endStarts = 1_000 + (endStep?.startMs ?? 0);
    expect(bottomSlot(null, core.frameAt(endStarts), ui)).toEqual({ kind: "none" });
    syncCues(push(5, events), core.frameAt(endStarts));
    expect(playCue.mock.calls).toEqual([["bankrupt"], ["gameEnd"]]);

    // The podium's own frame, and every later one, plays nothing more.
    expect(podiumAt).toBeGreaterThan(endStarts);
    for (const time of core.boundaries) {
      if (podiumAt === undefined || time < podiumAt) continue;
      syncCues(push(5, events), core.frameAt(time));
    }
    syncCues(push(5, events), core.frameAt(core.opensAt + 1_000));
    expect(playCue.mock.calls).toEqual([["bankrupt"], ["gameEnd"]]);
  });
});
