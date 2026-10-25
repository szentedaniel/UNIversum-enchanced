import { describe, expect, it } from "vitest";
import { sendIntent } from "#connection.ts";
import { inFlightOf, initialRoomState, roomStore } from "#stores/room-store.ts";
import { viewOf } from "./playback-fixtures.ts";

// The in-flight lock ("No optimistic UI", spec #72): a send is unanswered
// until a push or a Rejection with a later `seq` arrives. Only the connection
// writes it, so this test sends through `sendIntent` and reads the store.

const ROLL = { type: "Roll", turn: 1 } as const;

const pushAt = (seq: number): void => {
  roomStore.setState({
    push: { view: viewOf(), events: [], reveals: [], seq, clockOffset: 0, receivedAt: 0 },
  });
};

const reset = (): void => roomStore.setState(initialRoomState);

describe("the in-flight lock", () => {
  it("is set by a send and cleared by a push with a later seq", () => {
    reset();
    pushAt(1);
    sendIntent(ROLL);
    expect(inFlightOf(roomStore.getState())).toBe(true);

    pushAt(2);
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by a Rejection with a later seq", () => {
    reset();
    pushAt(1);
    sendIntent(ROLL);
    expect(inFlightOf(roomStore.getState())).toBe(true);

    roomStore.setState({ rejection: { code: "NOT_YOUR_TURN", seq: 2 } });
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by a reset to the initial state", () => {
    reset();
    pushAt(1);
    sendIntent(ROLL);
    expect(inFlightOf(roomStore.getState())).toBe(true);

    reset();
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });
});
