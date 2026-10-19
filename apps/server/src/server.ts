import { LobbyRoom, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM } from "@universum/protocol";
import { GameRoom } from "#room/game-room.ts";

export type GameServerOptions = {
  /** Register SIGINT/SIGTERM handlers (off in tests). */
  gracefullyShutdown?: boolean;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    gracefullyShutdown: options.gracefullyShutdown ?? true,
  });
  server.define(GAME_ROOM, GameRoom).enableRealtimeListing();
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}
