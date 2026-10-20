import { LobbyRoom, matchMaker, Server, type AuthContext } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM, refusalMessage } from "@universum/protocol";
import { createGatedHttpServer } from "#abuse/gated-http.ts";
import { AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import { DEFAULT_LIMITS, type Limits } from "#limits.ts";
import { apply, migrate } from "@universum/rules";
import type { Dsn } from "#observability/dsn.ts";
import { noReporter, type ErrorReporter } from "#observability/error-reporting.ts";
import { createIpTagger, limiterRefused } from "#observability/limiter-refusals.ts";
import { colyseusLogger, silentLogger, type Logger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import { createBrowserRoutes } from "#http/browser-routes.ts";
import { GameRoom, restoreOptions, type GameTiming } from "#room/game-room.ts";
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
  /** Every Room's metrics (`/metrics` on the internal port); a fresh set by default. */
  metrics?: GameMetrics;
  /** The server's logger, also handed to Colyseus; silent by default. */
  log?: Logger;
  /** Abuse-protection limits (`config.limits`); the spec's defaults when left out. */
  limits?: Limits;
  /** Where errors are reported (`SENTRY_DSN`); nowhere by default. */
  reporter?: ErrorReporter;
  /** The tracker DSN served to clients and forwarded to by `/errors`; `null` = reporting off. */
  errorReporting?: Dsn | null;
  /** The rules engine's `apply` (tests pass one that throws). */
  engine?: typeof apply;
  /** Shorter Turns and minutes for e2e runs (`GAME_TURN_LIMIT_MS`, `GAME_MINUTE_MS`); empty by default. */
  timing?: GameTiming;
};

/** The Colyseus server with every Room type defined, not yet listening. */
export function createGameServer(options: GameServerOptions): Server {
  const {
    store,
    metrics = new GameMetrics({ release: "dev" }),
    log = silentLogger,
    reporter = noReporter,
    engine = apply,
    timing = {},
  } = options;
  const ipTag = createIpTagger();
  const guard = new AbuseGuard(options.limits ?? DEFAULT_LIMITS, (limit, bucket) =>
    limiterRefused({ log, metrics, ipTag }, limit, bucket),
  );
  const routes = createBrowserRoutes({ dsn: options.errorReporting ?? null, guard, log });
  const transport = new WebSocketTransport({
    server: createGatedHttpServer(guard, routes),
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
    logger: colyseusLogger(log),
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
        override store = store;
        override metrics = metrics;
        override log = log;
        override reporter = reporter;
        override engine = engine;
        override timing = timing;
      },
    )
    .enableRealtimeListing();
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}

export type RestoreOptions = {
  store: RoomStore;
  scheduler?: Scheduler;
  /** Gets `rooms_restored` and `restore_duration_seconds`. */
  metrics?: GameMetrics;
  /** Told about each stored Room that can't be restored (it stays stored). */
  log?: Logger;
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
  metrics,
  log = silentLogger,
}: RestoreOptions): Promise<number> {
  const started = performance.now();
  let restored = 0;
  for (const stored of store.unfinished()) {
    try {
      const game = stored.game === null ? null : migrate(stored.game);
      // oxlint-disable-next-line no-await-in-loop -- one Room at a time keeps boot order simple
      await matchMaker.createRoom(GAME_ROOM, restoreOptions({ ...stored, game }));
      restored += 1;
    } catch (error) {
      log.error({ roomCode: stored.code, err: error }, "Room not restored (it stays stored)");
    }
  }
  for (const { code, endedAt } of store.ended()) {
    deleteAfterRetention(store, scheduler, code, endedAt);
  }
  metrics?.restored(restored, (performance.now() - started) / 1000);
  return restored;
}
