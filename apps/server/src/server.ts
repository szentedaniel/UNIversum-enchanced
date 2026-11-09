import { mkdirSync } from "node:fs";
import { LobbyRoom, matchMaker, Server, type AuthContext } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM, LOBBY_ROOM, refusalMessage } from "@universum/protocol";
import { createGatedHttpServer } from "#abuse/gated-http.ts";
import { AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import type { ServerConfig } from "#config.ts";
import { startInternalServer } from "#internal-server.ts";
import { DEFAULT_LIMITS, type Limits } from "#limits.ts";
import { apply, migrate } from "@universum/rules";
import { installCrashHandlers } from "#observability/crash-handlers.ts";
import { parseDsn, type Dsn } from "#observability/dsn.ts";
import { noReporter, type ErrorReporter } from "#observability/error-reporting.ts";
import { createIpTagger, limiterRefused } from "#observability/limiter-refusals.ts";
import { colyseusLogger, silentLogger, type Logger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import { createSentryReporter } from "#observability/sentry-reporter.ts";
import { createBrowserRoutes } from "#http/browser-routes.ts";
import { GameRoom, restoreOptions, type GameTiming } from "#room/game-room.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore } from "#store/room-store.ts";
import { openSqliteRoomStore } from "#store/sqlite-room-store.ts";

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

/** What `startServer` takes over: every server seam, and the process hooks. */
export type StartServerDeps = Partial<GameServerOptions> & {
  /**
   * Install the process crash handlers (the default, as the real server
   * does). In-process test servers pass `false`, and `gracefullyShutdown: false`
   * for the signal hooks.
   */
  crashHandlers?: boolean;
};

/** A booted server: the bound ports, the restored Rooms and the shutdown. */
export type StartedServer = {
  /** The actual bound HTTP + WebSocket port (`PORT=0` picks a free one). */
  port: number;
  /** The actual bound internal port (`/healthz`, `/readyz`, `/metrics`). */
  internalPort: number;
  /** How many stored Rooms the boot restored. */
  restored: number;
  /** Stops every Room, then the store and the internal server; safe to call twice. */
  stop(): Promise<void>;
};

/**
 * Boots the server the way `main.ts` does after it has config and a logger:
 * open the store, start the internal port, define every Room, listen, restore
 * the stored Rooms, and only then report ready. Production and every
 * in-process test take this one path, so the order is exercised by tests.
 * The store it opens, or is handed, is closed after every Room has stopped.
 */
export async function startServer(
  config: ServerConfig,
  deps: StartServerDeps = {},
): Promise<StartedServer> {
  const log = deps.log ?? silentLogger;
  const metrics = deps.metrics ?? new GameMetrics({ release: config.release });
  const errorReporting =
    deps.errorReporting !== undefined
      ? deps.errorReporting
      : config.sentryDsn === null
        ? null
        : parseDsn(config.sentryDsn);
  const reporter =
    deps.reporter ??
    (errorReporting === null
      ? noReporter
      : createSentryReporter({ dsn: errorReporting, release: config.release }));
  if (deps.crashHandlers ?? true) {
    installCrashHandlers({
      source: process,
      log,
      reporter,
      exit: (code) => process.exit(code),
    });
  }

  const store = deps.store ?? openStore(config);
  const scheduler = deps.scheduler ?? systemScheduler;
  const internal = await startInternalServer({
    port: config.internalPort,
    host: config.host,
    metrics,
  });
  const server = createGameServer({
    store,
    scheduler,
    metrics,
    log,
    reporter,
    errorReporting,
    engine: deps.engine,
    limits: deps.limits ?? config.limits,
    timing: deps.timing ?? config.timing,
    gracefullyShutdown: deps.gracefullyShutdown ?? true,
  });
  server.onBeforeShutdown(() => log.info("Server shutting down"));
  // Every Room has stopped before the store closes.
  server.onShutdown(async () => {
    store.close();
    await internal.close();
    log.info("Server stopped");
  });

  await server.listen(config.port, config.host);
  // The actual port (PORT=0 binds any free one), so a caller can reach it.
  const address = server.transport.server?.address();
  const port = address && typeof address !== "string" ? address.port : config.port;
  log.info({ port, internalPort: internal.port, release: config.release }, "Server listening");

  const started = performance.now();
  const restored = await restoreRooms({ store, scheduler, metrics, log });
  log.info({ restored, durationMs: Math.round(performance.now() - started) }, "Rooms restored");
  internal.ready();
  log.info("Server ready");

  let stopping: Promise<void> | undefined;
  return {
    port,
    internalPort: internal.port,
    restored,
    stop: () => (stopping ??= server.gracefullyShutdown(false)),
  };
}

/** Opens the configured SQLite store, creating its folder first. */
function openStore(config: ServerConfig): RoomStore {
  mkdirSync(config.dataDir, { recursive: true });
  return openSqliteRoomStore(config.databasePath);
}

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

type RestoreOptions = {
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
 * scheduled for deletion. Called by `startServer` once the server listens;
 * `/readyz` turns green when it resolves. Returns how many Rooms were restored.
 */
async function restoreRooms({
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
