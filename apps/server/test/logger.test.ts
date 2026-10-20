import { describe, expect, it } from "vitest";
import { captureLogs } from "./helpers.ts";
import { colyseusLogger, createLogger } from "#observability/logger.ts";

describe("the logger", () => {
  it("writes NDJSON lines at the configured level", () => {
    const capture = captureLogs();
    const log = createLogger({ level: "info", stream: capture.stream });

    log.debug("not written");
    log.info({ roomCode: "123456" }, "Room created");

    expect(capture.lines()).toEqual([
      expect.objectContaining({ level: 30, roomCode: "123456", msg: "Room created" }),
    ]);
  });

  it("redacts secrets and IPs wherever a caller puts them, as a safety net", () => {
    const capture = captureLogs();
    const log = createLogger({ level: "debug", stream: capture.stream });

    log.info(
      {
        guestToken: "secret-guest-token",
        guestTokenHash: "secret-token-hash",
        reconnectionToken: "secret-reconnection",
        password: "secret-password",
        passwordHash: "secret-password-hash",
        ip: "203.0.113.7",
        remoteAddress: "203.0.113.8",
        snapshot: { secret: "full-snapshot" },
        options: { password: "nested-password", guestToken: "nested-token" },
        seat: { tokenHash: "nested-hash" },
        headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.10" },
      },
      "joined",
    );

    expect(capture.text()).not.toMatch(/secret|nested|203\.0\.113/);
    expect(capture.lines()[0]).toMatchObject({ password: "[redacted]", msg: "joined" });
  });

  it("takes Colyseus' own console-style logs, tagged as Colyseus'", () => {
    const capture = captureLogs();
    const log = colyseusLogger(createLogger({ level: "debug", stream: capture.stream }));

    log.warn("option %j is ignored", "x", "and more");
    log.error(new Error("boom"));

    expect(capture.lines()).toEqual([
      expect.objectContaining({
        level: 40,
        component: "colyseus",
        msg: 'option "x" is ignored and more',
      }),
      expect.objectContaining({
        level: 50,
        component: "colyseus",
        err: expect.objectContaining({ message: "boom" }),
      }),
    ]);
  });
});
