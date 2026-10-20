import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import { REJECTION_CODES, type RejectionCode } from "@universum/protocol";

/** What a live Room reports to the gauges at each scrape. */
export type RoomGauges = {
  /** `null` once the game has ended (an ended Room is no longer counted). */
  state: "lobby" | "playing" | null;
  /** Seats with a live connection. */
  connected: number;
  /** Taken Seats nobody is connected to (dropped, or restored and not yet rejoined). */
  held: number;
};

/** A Room the gauges read; `GameRoom` registers itself while it is live. */
export type MeteredRoom = { gauges(): RoomGauges };

/**
 * The limiters whose refusals `limiter_refusals_total{limit}` counts: a closed
 * set, so the label never carries anything else. #37 owns these names; change
 * them here to match its limiters.
 */
export const LIMITER_LIMITS = [
  "room_creations",
  "open_lobbies",
  "joins",
  "seat_reservations",
  "sockets",
  "password_room",
  "password_ip",
  "lobby_cap",
  "intent_flood",
] as const;
export type LimiterLimit = (typeof LIMITER_LIMITS)[number];

// Game intents take well under a millisecond; a store write a few. Buckets from 0.5 ms to 1 s.
const LATENCY_BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1];

/**
 * The server's Prometheus metrics (spec: Observability → Metrics), served on
 * the internal port at `/metrics`. One instance per server, with its own
 * registry: default process and event-loop metrics, `build_info{release}` and
 * the game metrics. No label ever carries a Room code, Guest or Player; every
 * label value comes from a closed set.
 */
export class GameMetrics {
  readonly registry = new Registry();
  readonly #rooms = new Set<MeteredRoom>();

  readonly #intents: Counter<"result">;
  readonly #rejections: Counter<"code">;
  readonly #intentDuration: Histogram;
  readonly #storeWriteDuration: Histogram;
  readonly #roomsRestored: Gauge;
  readonly #restoreDuration: Gauge;
  readonly #seatDrops: Counter;
  readonly #seatReconnects: Counter;
  readonly #limiterRefusals: Counter<"limit">;

  constructor(options: { release: string }) {
    const registers = [this.registry];
    collectDefaultMetrics({ register: this.registry });
    new Gauge({
      name: "build_info",
      help: "The running build (git SHA as release); the value is always 1.",
      labelNames: ["release"],
      registers,
    }).set({ release: options.release }, 1);

    const rooms = () => [...this.#rooms].map((room) => room.gauges());
    new Gauge({
      name: "rooms",
      help: "Live Rooms by state.",
      labelNames: ["state"],
      registers,
      collect() {
        const states = rooms().map((r) => r.state);
        this.set({ state: "lobby" }, states.filter((s) => s === "lobby").length);
        this.set({ state: "playing" }, states.filter((s) => s === "playing").length);
      },
    });
    new Gauge({
      name: "players_connected",
      help: "Seats with a live connection.",
      registers,
      collect() {
        this.set(rooms().reduce((sum, r) => sum + r.connected, 0));
      },
    });
    new Gauge({
      name: "seats_held_disconnected",
      help: "Taken Seats nobody is connected to (held for a reconnect).",
      registers,
      collect() {
        this.set(rooms().reduce((sum, r) => sum + r.held, 0));
      },
    });

    this.#intents = new Counter({
      name: "intents_total",
      help: "Intents received from Players, by result.",
      labelNames: ["result"],
      registers,
    });
    this.#intents.inc({ result: "accepted" }, 0);
    this.#intents.inc({ result: "rejected" }, 0);
    this.#rejections = new Counter({
      name: "rejections_total",
      help: "Rejections sent to the intent's sender, by Rejection code.",
      labelNames: ["code"],
      registers,
    });
    for (const code of REJECTION_CODES) this.#rejections.inc({ code }, 0);
    this.#intentDuration = new Histogram({
      name: "intent_duration_seconds",
      help: "Handling one intent: apply, store write and broadcast.",
      buckets: LATENCY_BUCKETS,
      registers,
    });
    this.#storeWriteDuration = new Histogram({
      name: "room_store_write_duration_seconds",
      help: "One RoomStore write (a Room's snapshot and an intent's events).",
      buckets: LATENCY_BUCKETS,
      registers,
    });
    this.#roomsRestored = new Gauge({
      name: "rooms_restored",
      help: "Rooms restored from the store at boot.",
      registers,
    });
    this.#restoreDuration = new Gauge({
      name: "restore_duration_seconds",
      help: "How long the restore at boot took.",
      registers,
    });
    this.#seatDrops = new Counter({
      name: "seat_drops_total",
      help: "Connections lost by a Player holding a Seat in a running game.",
      registers,
    });
    this.#seatReconnects = new Counter({
      name: "seat_reconnects_total",
      help: "Players back in their held Seat.",
      registers,
    });
    this.#limiterRefusals = new Counter({
      name: "limiter_refusals_total",
      help: "Requests refused by an abuse limit, by limit.",
      labelNames: ["limit"],
      registers,
    });
    for (const limit of LIMITER_LIMITS) this.#limiterRefusals.inc({ limit }, 0);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** The text exposition of every metric. */
  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  /** Counts a live Room in the gauges until `untrackRoom`. */
  trackRoom(room: MeteredRoom): void {
    this.#rooms.add(room);
  }

  untrackRoom(room: MeteredRoom): void {
    this.#rooms.delete(room);
  }

  /** One intent handled; `rejection` is the code sent back, or `null` when it was accepted. */
  intentHandled(rejection: RejectionCode | null, seconds: number): void {
    this.#intents.inc({ result: rejection === null ? "accepted" : "rejected" });
    this.#intentDuration.observe(seconds);
  }

  /** A Rejection sent to a client. */
  rejected(code: RejectionCode): void {
    this.#rejections.inc({ code });
  }

  /** Runs one store write and times it (also when it throws). */
  timeStoreWrite<T>(write: () => T): T {
    const end = this.#storeWriteDuration.startTimer();
    try {
      return write();
    } finally {
      end();
    }
  }

  /** The restore at boot finished. */
  restored(rooms: number, seconds: number): void {
    this.#roomsRestored.set(rooms);
    this.#restoreDuration.set(seconds);
  }

  seatDropped(): void {
    this.#seatDrops.inc();
  }

  /** A Player is back in a held Seat (#35 calls this when a reconnect or rejoin lands). */
  seatReconnected(): void {
    this.#seatReconnects.inc();
  }

  /** An abuse limit refused a request (#37 calls this, through `limiterRefused`). */
  limiterRefused(limit: LimiterLimit): void {
    this.#limiterRefusals.inc({ limit });
  }
}
