import { describe, expect, it } from "vitest";
import { loadConfig } from "#config.ts";

describe("loadConfig", () => {
  it("falls back to dev defaults when the environment sets nothing", () => {
    const config = loadConfig({});

    expect(config.port).toBe(2567);
    expect(config.host).toBe("127.0.0.1");
    expect(config.dataDir).toMatch(/apps[/\\]server[/\\]data$/);
    expect(config.databasePath).toMatch(/apps[/\\]server[/\\]data[/\\]rooms\.sqlite$/);
    expect(config.internalPort).toBe(9464);
    expect(config.logLevel).toBe("debug");
    expect(config.prettyLogs).toBe(true);
    expect(config.release).toBe("dev");
  });

  it("logs at info, as plain NDJSON, in production", () => {
    const config = loadConfig({ NODE_ENV: "production" });

    expect(config.logLevel).toBe("info");
    expect(config.prettyLogs).toBe(false);
  });

  it("reports errors only when SENTRY_DSN is set, and refuses a DSN that isn't one", () => {
    expect(loadConfig({}).sentryDsn).toBeNull();
    expect(loadConfig({ SENTRY_DSN: "" }).sentryDsn).toBeNull();
    expect(loadConfig({ SENTRY_DSN: "https://abc123@errors.example.org/7" }).sentryDsn).toBe(
      "https://abc123@errors.example.org/7",
    );
    expect(() => loadConfig({ SENTRY_DSN: "errors.example.org" })).toThrow(/SENTRY_DSN/);
    expect(() => loadConfig({ SENTRY_DSN: "https://errors.example.org/7" })).toThrow(/SENTRY_DSN/);
  });

  it("lets LOG_LEVEL override the level, and refuses an unknown one", () => {
    expect(loadConfig({ NODE_ENV: "production", LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(loadConfig({ LOG_LEVEL: "warn" }).logLevel).toBe("warn");
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("takes every setting from the environment", () => {
    const config = loadConfig({
      PORT: "3001",
      HOST: "0.0.0.0",
      DATA_DIR: "/var/lib/universum",
      INTERNAL_PORT: "9100",
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      RELEASE: "0123abc",
    });

    expect(config).toMatchObject({
      port: 3001,
      host: "0.0.0.0",
      dataDir: "/var/lib/universum",
      databasePath: "/var/lib/universum/rooms.sqlite",
      internalPort: 9100,
      logLevel: "warn",
      prettyLogs: false,
      release: "0123abc",
    });
  });

  it.each(["abc", "-1", "65536", "1.5", ""])("rejects PORT=%j", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
    expect(() => loadConfig({ INTERNAL_PORT: port })).toThrow(/INTERNAL_PORT/);
  });

  it("holds the spec's abuse-protection limits by default", () => {
    expect(loadConfig({}).limits).toEqual({
      roomCreationsPerMinute: 10,
      roomCreationsPerHour: 60,
      openLobbiesPerIp: 15,
      joinsPerMinute: 60,
      seatReservationsPerIp: 10,
      socketsPerIp: 100,
      seatReservationSeconds: 5,
      liveLobbies: 2000,
      spectatorsPerRoom: 10,
      passwordFailuresPerMinute: 5,
      passwordLockSeconds: 60,
      passwordLockMaxSeconds: 3600,
      passwordFailuresPerIp: 30,
      passwordFailuresPerIpWindowSeconds: 600,
      intentsPerSecond: 10,
      chatsPerSecond: 1,
      intentFloodCloseSeconds: 5,
      intentBurstClose: 50,
      maxPayloadBytes: 1024,
      matchmakeBodyBytes: 2048,
      errorEventsPerMinute: 10,
      errorReportBytes: 204800,
    });
  });

  it("overrides each limit from its LIMIT_ variable", () => {
    const { limits } = loadConfig({
      LIMIT_JOINS_PER_MINUTE: "6000",
      LIMIT_ROOM_CREATIONS_PER_HOUR: "100000",
      LIMIT_SEAT_RESERVATION_SECONDS: "15",
      LIMIT_CHATS_PER_SECOND: "3",
    });

    expect(limits).toMatchObject({
      joinsPerMinute: 6000,
      roomCreationsPerHour: 100000,
      seatReservationSeconds: 15,
      chatsPerSecond: 3,
      roomCreationsPerMinute: 10,
    });
  });

  it.each(["0", "-3", "1.5", "lots", ""])("rejects LIMIT_SOCKETS_PER_IP=%j", (value) => {
    expect(() => loadConfig({ LIMIT_SOCKETS_PER_IP: value })).toThrow(/LIMIT_SOCKETS_PER_IP/);
  });
});
