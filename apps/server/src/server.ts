import { LobbyRoom, matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM } from "@universum/protocol";
import { migrate } from "@universum/rules";
import { GameRoom, restoreOptions } from "#room/game-room.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore } from "#store/room-store.ts";

export type GameServerOptions = {
  /** Where every Room is saved and restored from. */
  store: RoomStore;
  /** Register SIGINT/SIGTERM handlers (off in tests). */
  gracefullyShutdown?: boolean;
  /** The clock and wake-ups every Room uses (tests pass a manual one). */
  scheduler?: Scheduler;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
  });
  const scheduler = options.scheduler ?? systemScheduler;
  const { store } = options;
  server
    .define(
      GAME_ROOM,
      class extends GameRoom {
        override scheduler = scheduler;
        override store = store;
      },
    )
    .enableRealtimeListing();
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}

export type RestoreOptions = {
  store: RoomStore;
  scheduler?: Scheduler;
  /** Told about each stored Room that can't be restored (it stays stored). */
  onError?: (code: string, error: unknown) => void;
};

/**
 * Restore on boot (spec): every unfinished Room comes back under its own
 * code, its game run through the engine's migrations first; ended Rooms are
 * scheduled for deletion. Call it once the server listens; `/readyz` turns
 * green when it resolves. Returns how many Rooms were restored.
 */
export async function restoreRooms({
  store,
  scheduler = systemScheduler,
  onError = () => {},
}: RestoreOptions): Promise<number> {
  let restored = 0;
  for (const stored of store.unfinished()) {
    try {
      const game = stored.game === null ? null : migrate(stored.game);
      // oxlint-disable-next-line no-await-in-loop -- one Room at a time keeps boot order simple
      await matchMaker.createRoom(GAME_ROOM, restoreOptions({ ...stored, game }));
      restored += 1;
    } catch (error) {
      onError(stored.code, error);
    }
  }
  for (const { code, endedAt } of store.ended()) {
    deleteAfterRetention(store, scheduler, code, endedAt);
  }
  return restored;
}
