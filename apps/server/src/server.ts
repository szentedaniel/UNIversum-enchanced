import { LobbyRoom, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM } from "@universum/protocol";
import { GameRoom } from "#room/game-room.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";

export type GameServerOptions = {
  /** Register SIGINT/SIGTERM handlers (off in tests). */
  gracefullyShutdown?: boolean;
  /** The clock and wake-ups every Room uses (tests pass a manual one). */
  scheduler?: Scheduler;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
  });
  const scheduler = options.scheduler ?? systemScheduler;
  server
    .define(
      GAME_ROOM,
      class extends GameRoom {
        override scheduler = scheduler;
      },
    )
    .enableRealtimeListing();
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}
