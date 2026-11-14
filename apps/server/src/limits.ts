/**
 * Every abuse-protection limit (spec: Abuse protection), with the spec's
 * values as defaults. Each one is overridable by an environment variable named
 * after it: `LIMIT_` + the key in SCREAMING_SNAKE_CASE (`joinsPerMinute` →
 * `LIMIT_JOINS_PER_MINUTE`). Per-IP counts are keyed on the IP, an IPv6
 * address bucketed by its /64.
 */
export const DEFAULT_LIMITS = {
  /** Room creations per IP per minute. */
  roomCreationsPerMinute: 10,
  /** Room creations per IP per hour. */
  roomCreationsPerHour: 60,
  /** Lobbies one IP has created that are open at once (not started, not closed). */
  openLobbiesPerIp: 15,
  /** Join attempts per IP per minute; a wrong Room code counts. */
  joinsPerMinute: 60,
  /** Seats reserved for an IP whose WebSocket has not arrived yet. */
  seatReservationsPerIp: 10,
  /** Open WebSockets per IP. */
  socketsPerIp: 100,
  /** How long a reserved Seat waits for its WebSocket (Colyseus `seatReservationTimeout`). */
  seatReservationSeconds: 5,
  /** Live Lobbies per server; at the cap Room creation answers `SERVER_BUSY`. Running games never count. */
  liveLobbies: 2000,
  /** Wrong passwords per (Room code + IP) per minute before `PASSWORD_LOCKED`. */
  passwordFailuresPerMinute: 5,
  /** The first `PASSWORD_LOCKED` wait; it doubles with each further lockout of the same (Room code + IP). */
  passwordLockSeconds: 60,
  /** The longest `PASSWORD_LOCKED` wait. */
  passwordLockMaxSeconds: 3600,
  /** Wrong passwords per IP, across Rooms, per `passwordFailuresPerIpWindowSeconds`. */
  passwordFailuresPerIp: 30,
  passwordFailuresPerIpWindowSeconds: 600,
  /** Intents per connection per second; extras are dropped with one `SLOW_DOWN`. */
  intentsPerSecond: 10,
  /** Quick-chat taps per connection per second (spec #176): tighter than intents, same ladder. */
  chatsPerSecond: 1,
  /** Seconds in a row over `intentsPerSecond` before the socket is closed. */
  intentFloodCloseSeconds: 5,
  /** More intents than this in one second close the socket at once. */
  intentBurstClose: 50,
  /** Largest WebSocket message (bytes); a bigger one closes the socket. */
  maxPayloadBytes: 1024,
  /** Largest matchmaking request body (bytes). */
  matchmakeBodyBytes: 2048,
  /** Error envelopes per IP per minute on the `/errors` tunnel. */
  errorEventsPerMinute: 10,
  /** Largest error envelope body (bytes) the `/errors` tunnel accepts. */
  errorReportBytes: 200 * 1024,
};

export type Limits = { [K in keyof typeof DEFAULT_LIMITS]: number };

type Env = Readonly<Record<string, string | undefined>>;

/** `joinsPerMinute` → `LIMIT_JOINS_PER_MINUTE`. */
export const limitEnvName = (key: keyof Limits): string =>
  `LIMIT_${key.replaceAll(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

const isLimit = (key: string): key is keyof Limits => key in DEFAULT_LIMITS;

export function loadLimits(env: Env): Limits {
  const limits: Limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS).filter(isLimit)) {
    const name = limitEnvName(key);
    const raw = env[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a whole number of at least 1, got ${JSON.stringify(raw)}`);
    }
    limits[key] = value;
  }
  return limits;
}
