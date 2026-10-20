import { LobbyRoom, matchMaker, Server, type AuthContext } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM, refusalMessage } from "@universum/protocol";
import { createGatedHttpServer } from "#abuse/gated-http.ts";
import { AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import { DEFAULT_LIMITS, type Limits } from "#limits.ts";
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
  /** Abuse-protection limits (`config.limits`); the spec's defaults when left out. */
  limits?: Limits;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions): Server {
  const guard = new AbuseGuard(options.limits ?? DEFAULT_LIMITS);
  const transport = new WebSocketTransport({
    server: createGatedHttpServer(guard),
    maxPayload: guard.limits.maxPayloadBytes,
    beforeUpgrade: (_request, context) => {
      const refusal = guard.socketRefusal(ipBucket(context.ip));
      return refusal ? new Response(refusalMessage(refusal), { status: 429 }) : undefined;
    },
  });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
  });
  const scheduler = options.scheduler ?? systemScheduler;
  const { store } = options;
  server
    .define(
      GAME_ROOM,
      class extends GameRoom {
        static override onAuth(_token: string, roomOptions: unknown, context: AuthContext) {
          return GameRoom.authorize(guard, roomOptions, context);
        }
        override scheduler = scheduler;
        override guard = guard;
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
