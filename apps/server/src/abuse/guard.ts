/**
 * The server's abuse protection state (spec: Abuse protection): per-IP
 * counters and limiters, all in memory (they reset on restart). One guard per
 * server; the HTTP gate, `beforeUpgrade`, the Room's static `onAuth` and the
 * Rooms ask it. Every per-IP key is an `ipBucket`.
 *
 * Where each limit is checked, always before a Seat is reserved:
 * - the matchmaking gate (`gated-http.ts`): Room creations per minute/hour and
 *   join attempts per minute. It sees every request, so a wrong Room code
 *   (which Colyseus refuses before `onAuth`) counts too.
 * - `beforeUpgrade`: open WebSockets.
 * - static `onAuth`: the live-Lobby cap, open Lobbies per IP, outstanding
 *   Seat reservations, and password guesses (before scrypt).
 */
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import type { Refusal } from "@universum/protocol";
import type { Limits } from "#limits.ts";
import type { LimiterLimit } from "#observability/metrics.ts";

export type RequestKind = "create" | "join";

/** Told about every refusal: which limit, and the IP bucket it refused (metrics and logs, #43). */
export type RefusalListener = (limit: LimiterLimit, bucket: string) => void;

/**
 * Set by the HTTP gate on every matchmaking request (any value a client sent
 * is overwritten): the id its Seat reservation, if any, is counted under, so
 * a refused request (say, a blocked Room name) frees it at once.
 */
export const REQUEST_ID_HEADER = "x-universum-request";

type Reservation = {
  bucket: string;
  kind: RequestKind;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

/** How long a (Room code + IP)'s lockouts are remembered for the back-off: longer than any Lobby lives. */
const LOCKOUT_MEMORY_SECONDS = 24 * 3600;

/** Whole seconds until `ms` milliseconds have passed, at least 1. */
const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

const rateLimited = (ms: number): Refusal => ({ code: "RATE_LIMITED", retryAfter: seconds(ms) });

const limiter = (keyPrefix: string, points: number, duration: number) =>
  new RateLimiterMemory({ keyPrefix, points, duration });

/** How long rlf says to wait, from a rejected `consume`; anything else is a real error. */
function waitOf(rejection: unknown): number {
  if (rejection instanceof RateLimiterRes) return rejection.msBeforeNext;
  throw rejection;
}

export class AbuseGuard {
  readonly limits: Limits;
  readonly #onRefusal: RefusalListener;
  readonly #creationsPerMinute: RateLimiterMemory;
  readonly #creationsPerHour: RateLimiterMemory;
  readonly #joins: RateLimiterMemory;
  readonly #errorEvents: RateLimiterMemory;
  readonly #passwordPerRoom: RateLimiterMemory;
  readonly #passwordPerIp: RateLimiterMemory;
  /** Lockouts per (Room code + IP), for the exponential back-off. */
  readonly #lockouts: RateLimiterMemory;
  readonly #sockets = new Map<string, number>();
  readonly #reservations = new Map<string, Reservation>();
  #lastRequest = 0;
  /** Live Lobbies by Room code, with the bucket of the IP that created it once its creator joined. */
  readonly #lobbies = new Map<string, string | null>();

  constructor(limits: Limits, onRefusal: RefusalListener = () => {}) {
    this.limits = limits;
    this.#onRefusal = onRefusal;
    this.#creationsPerMinute = limiter("create-min", limits.roomCreationsPerMinute, 60);
    this.#creationsPerHour = limiter("create-hour", limits.roomCreationsPerHour, 3600);
    this.#joins = limiter("join-min", limits.joinsPerMinute, 60);
    this.#errorEvents = limiter("errors-min", limits.errorEventsPerMinute, 60);
    this.#passwordPerRoom = limiter("pw-room", limits.passwordFailuresPerMinute, 60);
    this.#passwordPerIp = limiter(
      "pw-ip",
      limits.passwordFailuresPerIp,
      limits.passwordFailuresPerIpWindowSeconds,
    );
    this.#lockouts = limiter("pw-lockouts", Number.MAX_SAFE_INTEGER, LOCKOUT_MEMORY_SECONDS);
  }

  // ------------------------------------------------------------ request rates

  /** Counts one matchmaking request; `RATE_LIMITED` once the IP is over its rate. */
  async admitRequest(kind: RequestKind, bucket: string): Promise<Refusal | null> {
    const limiters: [RateLimiterMemory, LimiterLimit][] =
      kind === "create"
        ? [
            [this.#creationsPerMinute, "room_creations_per_minute"],
            [this.#creationsPerHour, "room_creations_per_hour"],
          ]
        : [[this.#joins, "joins_per_minute"]];
    // One after another: a request the per-minute limit refuses costs nothing per hour.
    for (const [rate, limit] of limiters) {
      // oxlint-disable-next-line no-await-in-loop -- in order, on purpose
      const wait = await rate.consume(bucket).then(() => 0, waitOf);
      if (wait > 0) return this.refused(limit, bucket, rateLimited(wait));
    }
    return null;
  }

  /** Reports a refusal by `limit` (counted and logged with the IP tag), and returns it. */
  refused<R>(limit: LimiterLimit, bucket: string, refusal: R): R {
    this.#onRefusal(limit, bucket);
    return refusal;
  }

  // ------------------------------------------------------------ error reports

  /** Counts one error envelope; `RATE_LIMITED` once this IP is over its rate. */
  async errorReportRefusal(bucket: string): Promise<Refusal | null> {
    const wait = await this.#errorEvents.consume(bucket).then(() => 0, waitOf);
    return wait > 0 ? this.refused("error_events", bucket, rateLimited(wait)) : null;
  }

  // ------------------------------------------------------------ sockets

  socketOpened(bucket: string): void {
    this.#sockets.set(bucket, (this.#sockets.get(bucket) ?? 0) + 1);
  }

  socketClosed(bucket: string): void {
    const open = (this.#sockets.get(bucket) ?? 0) - 1;
    if (open > 0) this.#sockets.set(bucket, open);
    else this.#sockets.delete(bucket);
  }

  /** `RATE_LIMITED` when the IP holds more open sockets than allowed (this one included). */
  socketRefusal(bucket: string): Refusal | null {
    return (this.#sockets.get(bucket) ?? 0) > this.limits.socketsPerIp
      ? this.refused("sockets", bucket, { code: "RATE_LIMITED" })
      : null;
  }

  // ------------------------------------------------------------ Seat reservations

  /** `RATE_LIMITED` (until the oldest one lapses) when the IP holds too many unused Seat reservations. */
  reservationRefusal(bucket: string): Refusal | null {
    const mine = [...this.#reservations.values()].filter((r) => r.bucket === bucket);
    if (mine.length < this.limits.seatReservationsPerIp) return null;
    const first = Math.min(...mine.map((r) => r.expiresAt));
    return this.refused("seat_reservations", bucket, rateLimited(first - Date.now()));
  }

  /** A fresh id for a matchmaking request (see `REQUEST_ID_HEADER`). */
  requestId(): string {
    return String(++this.#lastRequest);
  }

  /**
   * Counts a Seat about to be reserved for this IP until its WebSocket joins,
   * its request fails (`release`) or the reservation lapses. Returns the
   * reservation's id: the request's, when known.
   */
  reserve(bucket: string, kind: RequestKind, id = this.requestId()): string {
    const ms = this.limits.seatReservationSeconds * 1000;
    // A little slack past Colyseus's own timeout, so a Seat is never free before it is counted free.
    const timer = setTimeout(() => this.#reservations.delete(id), ms + 500);
    timer.unref();
    this.#reservations.set(id, { bucket, kind, expiresAt: Date.now() + ms, timer });
    return id;
  }

  /** The reserved Seat was taken, or its request failed. */
  release(id: string): void {
    clearTimeout(this.#reservations.get(id)?.timer);
    this.#reservations.delete(id);
  }

  // ------------------------------------------------------------ Lobbies

  lobbyOpened(code: string): void {
    this.#lobbies.set(code, null);
  }

  /** An ended game's Room is a Lobby again (a rematch, spec #175), under its creator's IP when known. */
  lobbyReopened(code: string, creatorBucket: string | null): void {
    this.#lobbies.set(code, creatorBucket);
  }

  /** The creator's Seat is taken: the Lobby counts against the creator's IP. */
  lobbyCreatedBy(code: string, bucket: string): void {
    if (this.#lobbies.has(code)) this.#lobbies.set(code, bucket);
  }

  /** The game started or the Room closed: the Lobby counts no more. */
  lobbyClosed(code: string): void {
    this.#lobbies.delete(code);
  }

  /**
   * Whether this IP may create a Room now: `SERVER_BUSY` at the live-Lobby
   * cap, `RATE_LIMITED` when it already has its share of open Lobbies (Rooms
   * still being created count too).
   */
  creationRefusal(bucket: string): Refusal | null {
    const creating = [...this.#reservations.values()].filter((r) => r.kind === "create");
    if (this.#lobbies.size + creating.length >= this.limits.liveLobbies) {
      return this.refused("live_lobbies", bucket, { code: "SERVER_BUSY" });
    }
    const open =
      [...this.#lobbies.values()].filter((b) => b === bucket).length +
      creating.filter((r) => r.bucket === bucket).length;
    return open >= this.limits.openLobbiesPerIp
      ? this.refused("open_lobbies", bucket, { code: "RATE_LIMITED" })
      : null;
  }

  // ------------------------------------------------------------ passwords

  /**
   * Counts one password guess before it is checked (so concurrent guesses
   * can't slip past): `PASSWORD_LOCKED` while this (Room code + IP) or this IP
   * is locked out. Report the outcome with `passwordFailed`/`passwordMatched`.
   */
  async passwordAttempt(code: string, bucket: string): Promise<Refusal | null> {
    const key = `${code}|${bucket}`;
    const room = await this.#passwordPerRoom.consume(key).then(() => 0, waitOf);
    if (room > 0) {
      return this.refused("password_room", bucket, {
        code: "PASSWORD_LOCKED",
        retryAfter: seconds(room),
      });
    }
    const ip = await this.#passwordPerIp.consume(bucket).then(() => 0, waitOf);
    if (ip > 0) {
      await this.#passwordPerRoom.reward(key);
      return this.refused("password_ip", bucket, {
        code: "PASSWORD_LOCKED",
        retryAfter: seconds(ip),
      });
    }
    return null;
  }

  /** A wrong password: the last allowed failure locks (Room code + IP), twice as long as the lockout before. */
  async passwordFailed(code: string, bucket: string): Promise<void> {
    const key = `${code}|${bucket}`;
    const failures = await this.#passwordPerRoom.get(key);
    if (!failures || failures.consumedPoints < this.limits.passwordFailuresPerMinute) return;
    const { consumedPoints: lockouts } = await this.#lockouts.consume(key);
    const lock = Math.min(
      this.limits.passwordLockSeconds * 2 ** (lockouts - 1),
      this.limits.passwordLockMaxSeconds,
    );
    await this.#passwordPerRoom.block(key, lock);
  }

  /** The right password: this (Room code + IP) starts afresh, and the guess costs the IP nothing. */
  async passwordMatched(code: string, bucket: string): Promise<void> {
    await this.#passwordPerRoom.delete(`${code}|${bucket}`);
    await this.#passwordPerIp.reward(bucket);
  }
}
