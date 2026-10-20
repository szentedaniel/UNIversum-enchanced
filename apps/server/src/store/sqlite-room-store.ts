import { DatabaseSync } from "node:sqlite";
import type { GameEvent } from "@universum/rules";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

/**
 * The SQLite `RoomStore` on `node:sqlite` (spec: RoomStore): one file on a
 * local volume (never NFS/SMB), WAL mode, one writing process.
 *
 * - `rooms`: one row per Room; `state` is the JSON snapshot (Settings, Seats,
 *   game), `version` the game's `version` (0 for a Lobby).
 * - `events`: one row per accepted intent with its events, for debugging and
 *   replay fixtures. The snapshot, not this log, is the source of truth.
 */
export type SqliteRoomStore = RoomStore & {
  /** SQLite's journal mode (`wal`), for tests. */
  journalMode(): string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rooms (
    code     TEXT PRIMARY KEY,
    version  INTEGER NOT NULL,
    state    TEXT NOT NULL,
    ended_at INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL,
    version INTEGER NOT NULL,
    events  TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_by_code ON events (code, id);
`;

/** The `state` JSON; Room fields added after a Room was stored may be missing. */
type Snapshot = Omit<StoredRoom<unknown>, "code" | "endedAt" | "roomName" | "password"> &
  Partial<Pick<StoredRoom<unknown>, "roomName" | "password">>;

export function openSqliteRoomStore(path: string): SqliteRoomStore {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const upsertRoom = db.prepare(
    `INSERT INTO rooms (code, version, state, ended_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (code) DO UPDATE SET
       version = excluded.version, state = excluded.state, ended_at = excluded.ended_at`,
  );
  const insertEvents = db.prepare("INSERT INTO events (code, version, events) VALUES (?, ?, ?)");
  const selectUnfinished = db.prepare(
    "SELECT code, state FROM rooms WHERE ended_at IS NULL ORDER BY code",
  );
  const selectEnded = db.prepare(
    "SELECT code, ended_at FROM rooms WHERE ended_at IS NOT NULL ORDER BY ended_at",
  );
  const selectCode = db.prepare("SELECT 1 FROM rooms WHERE code = ?");
  const deleteRoom = db.prepare("DELETE FROM rooms WHERE code = ?");
  const deleteEvents = db.prepare("DELETE FROM events WHERE code = ?");
  const selectEvents = db.prepare("SELECT version, events FROM events WHERE code = ? ORDER BY id");

  /** node:sqlite has no transaction helper: BEGIN IMMEDIATE … COMMIT, ROLLBACK on a throw. */
  function transaction(work: () => void): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    unfinished() {
      return selectUnfinished.all().map((row) => {
        const snapshot: Snapshot = JSON.parse(String(row["state"]));
        const { settings, seats, game, roomName = null, password = null } = snapshot;
        return {
          code: String(row["code"]),
          settings,
          roomName,
          password,
          seats,
          game,
          endedAt: null,
        };
      });
    },

    ended() {
      return selectEnded
        .all()
        .map((row) => ({ code: String(row["code"]), endedAt: Number(row["ended_at"]) }));
    },

    save(room, events) {
      const { code, endedAt, ...snapshot } = room;
      const version = room.game?.version ?? 0;
      transaction(() => {
        upsertRoom.run(code, version, JSON.stringify(snapshot), endedAt);
        if (events.length > 0) insertEvents.run(code, version, JSON.stringify(events));
      });
    },

    isCodeInUse(code) {
      return selectCode.get(code) !== undefined;
    },

    delete(code) {
      transaction(() => {
        deleteRoom.run(code);
        deleteEvents.run(code);
      });
    },

    events(code) {
      return selectEvents.all(code).map((row) => {
        const events: GameEvent[] = JSON.parse(String(row["events"]));
        return { version: Number(row["version"]), events };
      });
    },

    journalMode() {
      return String(db.prepare("PRAGMA journal_mode").get()?.["journal_mode"]);
    },

    close() {
      if (db.isOpen) db.close();
    },
  };
}
