/**
 * The abuse guard's time-based limits, on a fake clock (the server tests
 * cover the same limits end to end, but can't wait an hour).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbuseGuard } from "#abuse/guard.ts";
import { DEFAULT_LIMITS } from "#limits.ts";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 20, 12) });
});

afterEach(() => {
  vi.useRealTimers();
});

const MINUTE = 60_000;

describe("Room creations per hour", () => {
  it("allows 10 a minute but 60 an hour", async () => {
    const guard = new AbuseGuard(DEFAULT_LIMITS);
    for (let minute = 0; minute < 6; minute++) {
      for (let i = 0; i < 10; i++) {
        // oxlint-disable-next-line no-await-in-loop -- one after another
        expect(await guard.admitRequest("create", "ip")).toBeNull();
      }
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await guard.admitRequest("create", "ip")).toMatchObject({ code: "RATE_LIMITED" });
      vi.advanceTimersByTime(MINUTE);
    }

    const refusal = await guard.admitRequest("create", "ip");

    expect(refusal?.code).toBe("RATE_LIMITED");
    expect(refusal?.retryAfter).toBeGreaterThan(50 * 60);
  });
});

/** Five wrong guesses at Room 123456 from one IP. */
async function failFiveTimes(guard: AbuseGuard): Promise<void> {
  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one guess after another
    expect(await guard.passwordAttempt("123456", "ip")).toBeNull();
    // oxlint-disable-next-line no-await-in-loop -- one guess after another
    await guard.passwordFailed("123456", "ip");
  }
}

describe("password back-off", () => {
  it("doubles the lockout each time, up to the longest wait", async () => {
    const guard = new AbuseGuard({ ...DEFAULT_LIMITS, passwordFailuresPerIp: 1000 });
    const waits: (number | undefined)[] = [];
    for (let lockout = 0; lockout < 8; lockout++) {
      // oxlint-disable-next-line no-await-in-loop -- one lockout after another
      await failFiveTimes(guard);
      // oxlint-disable-next-line no-await-in-loop -- one lockout after another
      const locked = await guard.passwordAttempt("123456", "ip");
      expect(locked?.code).toBe("PASSWORD_LOCKED");
      waits.push(locked?.retryAfter);
      vi.advanceTimersByTime((locked?.retryAfter ?? 0) * 1000);
    }

    expect(waits).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });

  it("keeps a lockout to its Room code: the same IP may still guess elsewhere", async () => {
    const guard = new AbuseGuard(DEFAULT_LIMITS);
    await failFiveTimes(guard);

    expect(await guard.passwordAttempt("123456", "ip")).toMatchObject({ code: "PASSWORD_LOCKED" });
    expect(await guard.passwordAttempt("654321", "ip")).toBeNull();
  });
});

describe("Seat reservations", () => {
  it("lapse after the Seat reservation time", () => {
    const guard = new AbuseGuard({ ...DEFAULT_LIMITS, seatReservationsPerIp: 1 });
    guard.reserve("ip", "join");

    expect(guard.reservationRefusal("ip")).toEqual({ code: "RATE_LIMITED", retryAfter: 5 });
    vi.advanceTimersByTime(6_000);
    expect(guard.reservationRefusal("ip")).toBeNull();
  });
});
