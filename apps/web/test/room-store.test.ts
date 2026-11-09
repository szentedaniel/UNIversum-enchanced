import { beforeEach, describe, expect, it } from "vitest";
import {
  inFlightOf,
  markIntentSent,
  receivePush,
  receiveRejection,
  reset,
  roomStore,
} from "#stores/room-store.ts";
import { viewOf } from "./playback-fixtures.ts";

// The room store's write interface (#127): one `seq` counter behind every
// answer, the never-back-to-an-older `version` guard and the in-flight lock.
// Only those functions write here; the store is read the way a screen reads it.

const push = (patch: { version?: number; now?: number } = {}, receivedAt = 0) => ({
  view: viewOf(undefined, { version: patch.version ?? 1 }),
  events: [],
  reveals: [],
  now: patch.now ?? receivedAt,
});

beforeEach(reset);

describe("the answer's seq", () => {
  it("gives a Rejection a later seq than the push before it", () => {
    receivePush(push(), 0);
    receiveRejection("NOT_YOUR_TURN");
    expect(roomStore.getState().rejection!.seq).toBeGreaterThan(roomStore.getState().push!.seq);
  });

  it("gives a push a later seq than the Rejection before it", () => {
    receiveRejection("NOT_YOUR_TURN");
    receivePush(push(), 0);
    expect(roomStore.getState().push!.seq).toBeGreaterThan(roomStore.getState().rejection!.seq);
  });

  it("turns the server's clock into this client's offset", () => {
    receivePush(push({ now: 5_000 }), 4_000);
    expect(roomStore.getState().push).toMatchObject({ receivedAt: 4_000, clockOffset: 1_000 });
  });

  it("shows a push with the same version, as a rejoin sends the state again", () => {
    receivePush(push({ version: 2 }), 0);
    const first = roomStore.getState().push!.seq;
    receivePush(push({ version: 2 }), 1_000);
    expect(roomStore.getState().push!.view.version).toBe(2);
    expect(roomStore.getState().push!.receivedAt).toBe(1_000);
    expect(roomStore.getState().push!.seq).toBeGreaterThan(first);
  });

  it("ignores a push older than the one shown, without spending a seq", () => {
    receivePush(push({ version: 2 }), 0);
    const shown = roomStore.getState().push;
    receivePush(push({ version: 1 }), 1_000);
    expect(roomStore.getState().push).toEqual(shown);
    receiveRejection("NOT_YOUR_TURN");
    expect(roomStore.getState().rejection!.seq).toBeGreaterThan(shown!.seq);
  });
});

describe("the in-flight lock", () => {
  it("is set by a send and cleared by a push with a later seq", () => {
    receivePush(push(), 0);
    markIntentSent();
    expect(inFlightOf(roomStore.getState())).toBe(true);
    receivePush(push(), 1_000);
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by a Rejection with a later seq", () => {
    receivePush(push(), 0);
    markIntentSent();
    receiveRejection("NOT_YOUR_TURN");
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is set with no answer yet and cleared by the first push", () => {
    markIntentSent();
    expect(inFlightOf(roomStore.getState())).toBe(true);
    receivePush(push(), 0);
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });

  it("is cleared by reset", () => {
    receivePush(push(), 0);
    markIntentSent();
    reset();
    expect(roomStore.getState().push).toBeNull();
    expect(roomStore.getState().rejection).toBeNull();
    expect(inFlightOf(roomStore.getState())).toBe(false);
  });
});
