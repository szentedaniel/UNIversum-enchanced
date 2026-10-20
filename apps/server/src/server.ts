import { LobbyRoom, Server, type AuthContext } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM, refusalMessage } from "@universum/protocol";
import { createGatedHttpServer } from "#abuse/gated-http.ts";
import { AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import { DEFAULT_LIMITS, type Limits } from "#limits.ts";
import { GameRoom } from "#room/game-room.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";

export type GameServerOptions = {
  /** Register SIGINT/SIGTERM handlers (off in tests). */
  gracefullyShutdown?: boolean;
  /** The clock and wake-ups every Room uses (tests pass a manual one). */
  scheduler?: Scheduler;
  /** Abuse-protection limits (`config.limits`); the spec's defaults when left out. */
  limits?: Limits;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions = {}): Server {
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
  server
    .define(
      GAME_ROOM,
      class extends GameRoom {
        static override onAuth(_token: string, roomOptions: unknown, context: AuthContext) {
          return GameRoom.authorize(guard, roomOptions, context);
        }
        override scheduler = scheduler;
        override guard = guard;
      },
    )
    .enableRealtimeListing();
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}
