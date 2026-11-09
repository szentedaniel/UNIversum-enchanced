import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { GAME_ROOM } from "@universum/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "#config.ts";
import { DEFAULT_LIMITS } from "#limits.ts";
import { createLogger } from "#observability/logger.ts";
import { GameRoom } from "#room/game-room.ts";
import { startServer, type StartedServer } from "#server.ts";
import type { RoomStore } from "#store/room-store.ts";
import { openSqliteRoomStore } from "#store/sqlite-room-store.ts";
import { captureLogs } from "../test/helpers.ts";

// One server at a time per file: Colyseus' matchmaker is a process-wide singleton.
const running: StartedServer[] = [];

afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- one server at a time (the matchmaker is a singleton)
  for (const server of running.splice(0)) await server.stop();
});

function tempConfig(): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "universum-boot-"));
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir,
    limits: {
      ...DEFAULT_LIMITS,
      roomCreationsPerMinute: 10_000,
      roomCreationsPerHour: 10_000,
      openLobbiesPerIp: 10_000,
      joinsPerMinute: 10_000,
      seatReservationsPerIp: 10_000,
      socketsPerIp: 10_000,
    },
    databasePath: join(dataDir, "rooms.sqlite"),
    internalPort: 0,
    logLevel: "silent",
    prettyLogs: false,
    release: "test-release",
    sentryDsn: null,
    timing: {},
  };
}

const get = (port: number, path: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`);

describe("server boot", () => {
  it("binds both ports, logs them, and serves health, readiness and metrics", async () => {
    const config = tempConfig();
    const logs = captureLogs();
    const started = await startServer(config, {
      log: createLogger({ level: "info", stream: logs.stream }),
      crashHandlers: false,
      gracefullyShutdown: false,
    });
    running.push(started);

    const boot = logs
      .lines()
      .map((line) => String(line["msg"]))
      .filter((msg) => ["Server listening", "Rooms restored", "Server ready"].includes(msg));
    expect(boot).toEqual(["Server listening", "Rooms restored", "Server ready"]);
    expect(logs.lines().find((line) => line["msg"] === "Server listening")).toMatchObject({
      port: started.port,
      internalPort: started.internalPort,
      release: "test-release",
    });
    expect(started.port).toBeGreaterThan(0);
    expect(started.internalPort).toBeGreaterThan(0);

    expect(await (await get(started.port, "/__healthcheck")).text()).toBe("OK");
    expect((await get(started.internalPort, "/healthz")).status).toBe(200);
    expect((await get(started.internalPort, "/readyz")).status).toBe(200);
    expect(await (await get(started.internalPort, "/metrics")).text()).toContain(
      'build_info{release="test-release"} 1',
    );

    await started.stop();

    expect(
      logs
        .lines()
        .map((line) => line["msg"])
        .slice(-2),
    ).toEqual(["Server shutting down", "Server stopped"]);
    await expect(get(started.internalPort, "/readyz")).rejects.toThrow("fetch failed");
  });

  it("restores the stored Rooms before it returns, so it is ready only after restore", async () => {
    const config = tempConfig();
    const first = await startServer(config, {
      crashHandlers: false,
      gracefullyShutdown: false,
    });
    const sdk = new Client(`ws://127.0.0.1:${first.port}`);
    const created = await sdk.create(GAME_ROOM, { maxPlayers: 2 });
    const code = created.roomId;
    await first.stop();

    const logs = captureLogs();
    const second = await startServer(config, {
      log: createLogger({ level: "info", stream: logs.stream }),
      crashHandlers: false,
      gracefullyShutdown: false,
    });
    running.push(second);

    expect(second.restored).toBe(1);
    expect(matchMaker.getLocalRoomById(code)).toBeInstanceOf(GameRoom);
    expect((await get(second.internalPort, "/readyz")).status).toBe(200);
    const messages = logs.lines().map((line) => String(line["msg"]));
    expect(messages.indexOf("Rooms restored")).toBeGreaterThan(
      messages.indexOf("Server listening"),
    );
    expect(messages.indexOf("Server ready")).toBeGreaterThan(messages.indexOf("Rooms restored"));
  });

  it("closes the store only after every Room has stopped", async () => {
    const config = tempConfig();
    mkdirSync(config.dataDir, { recursive: true });
    const sqlite = openSqliteRoomStore(config.databasePath);
    let code: string | null = null;
    const liveRoomAtClose: boolean[] = [];
    const store: RoomStore = {
      ...sqlite,
      close() {
        liveRoomAtClose.push(code !== null && matchMaker.getLocalRoomById(code) !== undefined);
        sqlite.close();
      },
    };
    const started = await startServer(config, {
      store,
      crashHandlers: false,
      gracefullyShutdown: false,
    });
    running.push(started);
    const sdk = new Client(`ws://127.0.0.1:${started.port}`);
    const room = await sdk.create(GAME_ROOM, { maxPlayers: 2 });
    code = room.roomId;
    expect(matchMaker.getLocalRoomById(code)).toBeInstanceOf(GameRoom);

    await started.stop();

    expect(liveRoomAtClose).toEqual([false]);
  });
});
