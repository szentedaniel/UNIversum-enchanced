import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, setupGame, type GameEvent, type GameState } from "@universum/rules";
import { afterEach, describe, expect, it } from "vitest";
import type { StoredRoom } from "#store/room-store.ts";
import { openSqliteRoomStore, type SqliteRoomStore } from "#store/sqlite-room-store.ts";

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

const seats = [
  { playerId: "p1", name: { adjective: "brave", noun: "owl" } },
  { playerId: "p2", name: { adjective: "calm", noun: "fox" } },
];
const settings = { maxPlayers: 2, minuteLimit: 15 } as const;

const lobby = (code: string): StoredRoom => ({
  code,
  settings,
  roomName: null,
  creatorId: null,
  password: null,
  seats,
  game: null,
  endedAt: null,
});

function game(): GameState {
  return setupGame({ seats, settings, seed: [1, 2, 3, 4], now: T0 });
}

function rolled(state: GameState) {
  const result = apply(state, { type: "Roll", turn: state.turn }, { actor: "p1", now: state.actsAfter });
  if ("code" in result) throw new Error(result.code);
  return result;
}

const opened: SqliteRoomStore[] = [];

/** A store on a new SQLite file; `reopen` opens the same file again, as after a restart. */
function freshStore() {
  const path = join(mkdtempSync(join(tmpdir(), "universum-store-")), "rooms.sqlite");
  const open = () => {
    const store = openSqliteRoomStore(path);
    opened.push(store);
    return store;
  };
  return { store: open(), reopen: open };
}

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

describe("the SQLite RoomStore", () => {
  it("keeps a Lobby's Room name and password hash across a reopen, and none for a Room without them", () => {
    const { store, reopen } = freshStore();
    const named = {
      ...lobby("333333"),
      roomName: "Friday game",
      creatorId: "p1",
      password: { salt: "c2FsdA==", hash: "aGFzaA==" },
    };
    store.save(named, []);
    store.save(lobby("444444"), []);
    store.close();

    const rooms = reopen().unfinished();

    expect(rooms.find((room) => room.code === "333333")).toEqual(named);
    expect(rooms.find((room) => room.code === "444444")).toMatchObject({
      roomName: null,
      password: null,
    });
  });

  it("keeps Lobbies and running games across a reopen of the same file", () => {
    const { store, reopen } = freshStore();
    const running = rolled(game());
    store.save(lobby("111111"), []);
    store.save({ ...lobby("222222"), game: running.state }, running.events);
    store.close();

    const rooms = reopen().unfinished();

    expect(rooms.toSorted((a, b) => a.code.localeCompare(b.code))).toEqual([
      lobby("111111"),
      { ...lobby("222222"), game: running.state },
    ]);
  });

  it("keeps one row per Room: a save replaces the snapshot and appends that intent's events", () => {
    const { store } = freshStore();
    const first = rolled(game());
    // p1 again, back at the dice (the first roll may have stopped at an offer).
    const second = rolled({ ...first.state, currentPlayer: "p1", phase: { kind: "awaitingRoll" } });
    store.save({ ...lobby("333333"), game: game() }, []);
    store.save({ ...lobby("333333"), game: first.state }, first.events);
    store.save({ ...lobby("333333"), game: second.state }, second.events);

    expect(store.unfinished()).toEqual([{ ...lobby("333333"), game: second.state }]);
    expect(store.events("333333")).toEqual([
      { version: 1, events: first.events },
      { version: 2, events: second.events },
    ]);
  });

  it("saves the snapshot and its events all or nothing", () => {
    const { store } = freshStore();
    const before = game();
    store.save({ ...lobby("444444"), game: before }, []);
    const after = rolled(before);

    // An event that can't be written fails the whole save, the snapshot included.
    const unwritable = Object.assign({ type: "TurnPassed", player: "p1", turn: 3 } as const, {
      toJSON(): never {
        throw new Error("unwritable event");
      },
    });
    const events: GameEvent[] = [...after.events, unwritable];
    expect(() => store.save({ ...lobby("444444"), game: after.state }, events)).toThrow(
      /unwritable event/,
    );

    expect(store.unfinished()).toEqual([{ ...lobby("444444"), game: before }]);
    expect(store.events("444444")).toEqual([]);
  });

  it("tells whether a code is still stored, and forgets a deleted Room with its events", () => {
    const { store } = freshStore();
    const running = rolled(game());
    store.save({ ...lobby("555555"), game: running.state }, running.events);

    expect(store.isCodeInUse("555555")).toBe(true);
    expect(store.isCodeInUse("666666")).toBe(false);

    store.delete("555555");

    expect(store.isCodeInUse("555555")).toBe(false);
    expect(store.unfinished()).toEqual([]);
    expect(store.events("555555")).toEqual([]);
  });

  it("does not load ended Rooms as unfinished, but lists them with their end time until deleted", () => {
    const { store } = freshStore();
    store.save({ ...lobby("777777"), game: game(), endedAt: T0 }, []);

    expect(store.unfinished()).toEqual([]);
    expect(store.ended()).toEqual([{ code: "777777", endedAt: T0 }]);
    expect(store.isCodeInUse("777777")).toBe(true);
  });

  it("runs in WAL mode", () => {
    const { store } = freshStore();

    expect(store.journalMode()).toBe("wal");
  });
});
