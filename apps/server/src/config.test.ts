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
  });

  it("takes every setting from the environment", () => {
    const config = loadConfig({
      PORT: "3001",
      HOST: "0.0.0.0",
      DATA_DIR: "/var/lib/universum",
      INTERNAL_PORT: "9100",
    });

    expect(config).toMatchObject({
      port: 3001,
      host: "0.0.0.0",
      dataDir: "/var/lib/universum",
      databasePath: "/var/lib/universum/rooms.sqlite",
      internalPort: 9100,
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
      passwordFailuresPerMinute: 5,
      passwordLockSeconds: 60,
      passwordLockMaxSeconds: 3600,
      passwordFailuresPerIp: 30,
      passwordFailuresPerIpWindowSeconds: 600,
      intentsPerSecond: 10,
      intentFloodCloseSeconds: 5,
      intentBurstClose: 50,
      maxPayloadBytes: 1024,
      matchmakeBodyBytes: 2048,
    });
  });

  it("overrides each limit from its LIMIT_ variable", () => {
    const { limits } = loadConfig({
      LIMIT_JOINS_PER_MINUTE: "6000",
      LIMIT_ROOM_CREATIONS_PER_HOUR: "100000",
      LIMIT_SEAT_RESERVATION_SECONDS: "15",
    });

    expect(limits).toMatchObject({
      joinsPerMinute: 6000,
      roomCreationsPerHour: 100000,
      seatReservationSeconds: 15,
      roomCreationsPerMinute: 10,
    });
  });

  it.each(["0", "-3", "1.5", "lots", ""])("rejects LIMIT_SOCKETS_PER_IP=%j", (value) => {
    expect(() => loadConfig({ LIMIT_SOCKETS_PER_IP: value })).toThrow(/LIMIT_SOCKETS_PER_IP/);
  });
});
