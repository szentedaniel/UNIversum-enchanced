import type { GameEvent } from "@universum/rules";
import { PLAYBACK_MS } from "@universum/rules/playback";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentPlayback, playbackStore } from "#playback/playback-store.ts";
import { playbackOfPush } from "#playback/playback.ts";
import { roomStore } from "#stores/room-store.ts";
import { ROLL, viewOf } from "./playback-fixtures.ts";

// The Playback store (ADR-0004, spec #63): one timer, one frame. It reads the
// latest push when it arrives and again at every boundary the core names, so
// React sees the dice, the toast and the gate change on this client's clock.
// Fake timers: the wiring is what this test proves, not the arithmetic.

const T0 = 1_000;

const setPush = (
  seq: number,
  receivedAt: number,
  events: readonly GameEvent[],
  actsAfter: number,
  clockOffset = 0,
): void => {
  roomStore.setState({
    push: {
      view: viewOf(undefined, { actsAfter }),
      events,
      reveals: [],
      seq,
      receivedAt,
      clockOffset,
    },
  });
};

const advanceTo = (at: number): void => {
  vi.advanceTimersByTime(at - Date.now());
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  roomStore.setState({ push: null });
});

afterEach(() => {
  roomStore.setState({ push: null });
  vi.useRealTimers();
});

describe("the Playback store", () => {
  it("ADR-0004: reads the frame at each boundary and never a moment early", () => {
    // The server's wait ends long after the local Playback: the boundaries are
    // the dice, the walk, the Rent, the zero-length Turn passing and the gate.
    setPush(1, T0, ROLL(), 5_000);
    const core = currentPlayback();
    expect(core?.opensAt).toBe(5_000);

    // One publication per boundary: the frame object stays the same until the
    // boundary passes, however often React reads it.
    let shown = playbackStore.getState().frame;
    for (const at of core!.boundaries) {
      advanceTo(at - 1);
      expect(playbackStore.getState().frame).toBe(shown);
      advanceTo(at + 20);
      expect(playbackStore.getState().frame).not.toBe(shown);
      shown = playbackStore.getState().frame;
    }
    expect(shown?.gateOpen).toBe(true);
  });

  it("shows the dice, the walk, the Rent and the opening where the core puts them", () => {
    setPush(1, T0, ROLL(), 5_000);

    expect(playbackStore.getState().frame?.overlay?.kind).toBe("dice");
    expect(playbackStore.getState().frame?.toast?.event.type).toBe("DiceRolled");
    expect(playbackStore.getState().frame?.gateOpen).toBe(false);

    advanceTo(T0 + PLAYBACK_MS.DiceRolled + 20);
    expect(playbackStore.getState().frame?.overlay).toBeNull();
    expect(playbackStore.getState().frame?.walking).toBe("p1");
    expect(playbackStore.getState().frame?.toast?.event.type).toBe("DiceRolled");

    advanceTo(T0 + PLAYBACK_MS.DiceRolled + 7 * PLAYBACK_MS.Moved + 20);
    expect(playbackStore.getState().frame?.walking).toBeNull();
    expect(playbackStore.getState().frame?.toast?.event.type).toBe("RentPaid");
    expect(playbackStore.getState().frame?.gateOpen).toBe(false);

    advanceTo(5_020);
    expect(playbackStore.getState().frame?.gateOpen).toBe(true);
    // Story 4: the Turn card switches with the controls.
    expect(playbackStore.getState().frame?.shownTurn).toEqual({ turn: 2, currentPlayer: "p1" });
  });

  it("holds one core for the whole life of a push", () => {
    setPush(1, T0, ROLL(), 5_000);
    const core = currentPlayback();
    expect(core).not.toBeNull();
    // The Board's render loop (#67) gets that same core for its own reads.
    expect(currentPlayback()?.frameAt(Date.now()).seq).toBe(1);

    advanceTo(T0 + PLAYBACK_MS.DiceRolled + 20);
    expect(playbackStore.getState().frame?.overlay).toBeNull();
    expect(currentPlayback()).toBe(core);

    advanceTo(5_020);
    expect(playbackStore.getState().frame?.gateOpen).toBe(true);
    expect(currentPlayback()).toBe(core);
  });

  it("a new push replaces the previous frame and its timer", () => {
    setPush(1, T0, [], 60_000);
    expect(playbackStore.getState().frame?.seq).toBe(1);

    // A real push arrives while the first one is still waiting for actsAfter.
    setPush(2, T0, ROLL(), 5_000);
    expect(playbackStore.getState().frame?.seq).toBe(2);
    expect(playbackStore.getState().frame?.overlay?.kind).toBe("dice");
    expect(currentPlayback()?.opensAt).toBe(5_000);

    // The first push's opening never surfaces: the frame stays the second one's.
    advanceTo(60_100);
    expect(playbackStore.getState().frame?.seq).toBe(2);
    expect(playbackStore.getState().frame?.gateOpen).toBe(true);

    roomStore.setState({ push: null });
    expect(currentPlayback()).toBeNull();
    expect(playbackStore.getState().frame).toBeNull();
  });

  it("ADR-0004: a push with no events has one boundary, its actsAfter", () => {
    setPush(1, T0, [], 6_000);

    expect(playbackStore.getState().frame?.gateOpen).toBe(false);
    expect(playbackStore.getState().frame?.overlay).toBeNull();
    expect(playbackStore.getState().frame?.toast).toBeNull();
    expect(playbackStore.getState().frame?.pawns.get("p1")).toEqual({
      field: 8,
      toward: null,
      progress: 0,
    });
    // No Playback to hold: the current Turn shows at once.
    expect(playbackStore.getState().frame?.shownTurn).toEqual({ turn: 2, currentPlayer: "p1" });

    advanceTo(5_000);
    expect(playbackStore.getState().frame?.gateOpen).toBe(false);

    advanceTo(6_020);
    expect(playbackStore.getState().frame?.gateOpen).toBe(true);
  });

  it("ADR-0004: the gate opens at the server's actsAfter when it is later", () => {
    setPush(1, T0, ROLL(), T0 + 10_000);

    advanceTo(playbackOfPush(roomStore.getState().push!).opensAt);
    expect(playbackStore.getState().frame?.gateOpen).toBe(false);

    advanceTo(T0 + 10_020);
    expect(playbackStore.getState().frame?.gateOpen).toBe(true);
  });
});
