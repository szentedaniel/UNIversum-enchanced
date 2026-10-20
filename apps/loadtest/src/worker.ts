/**
 * One generator thread (spec: Load test). Each thread owns its share of the
 * Rooms and one SDK client; it creates/joins Rooms, starts games, acts on the
 * options the view offers, drops connections and rejoins them exactly as the
 * browser client does: `reconnectionToken` first, then the Guest token with
 * the shared back-off. It measures the client round trip and checks that a
 * rejoin lands in the same Seat and never shows an older version.
 */
import { randomBytes } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { Client, CloseCode, MatchMakeError, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  LOBBY_ROOM,
  MESSAGE,
  RECONNECT,
  backoffDelay,
  CLOSE_CODE,
  matchmakeRefusal,
  type ClientIntent,
  type CreateOptions,
  type GameMessage,
  type LobbyMessage,
  type RejectionMessage,
  type WelcomeMessage,
} from "@universum/protocol/messages";
import { chooseIntent, isGameOver, offeredIntents } from "#bot.ts";
import { THRESHOLDS } from "#config.ts";
import { dropPlanForGame, gameSeed, seededRandom, type DropPlan, type RoomPlan } from "#profile.ts";
import { emptyWorkerStats, type WorkerStats } from "#stats.ts";
import type { MainToWorker, WorkerConfig, WorkerToMain } from "#worker-protocol.ts";

const port = parentPort;
if (!port) throw new Error("the load test worker must be started in a worker thread");

/** Worker-thread messages, not `window.postMessage`: no target origin. */
function post(message: WorkerToMain): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port
  port?.postMessage(message);
}

const RESEAT_WINDOW_MS = THRESHOLDS.reseatSeconds * 1_000;
const RESTART_GRACE_MS = 2 * 60_000;

const stats = emptyWorkerStats();
let config: WorkerConfig;
let sdk: Client;
const groups: RoomGroup[] = [];
const watchers: LobbyWatcher[] = [];
let stopped = false;
let killAtMs: number | null = null;
let readyAtMs: number | null = null;
let cpuLast = process.cpuUsage();

const later = (delayMs: number, run: () => void): (() => void) => {
  const timer = setTimeout(
    () => {
      if (!stopped) run();
    },
    Math.max(0, delayMs),
  );
  return () => clearTimeout(timer);
};

const inRange = (range: readonly [number, number]): number =>
  range[0] + Math.random() * (range[1] - range[0]);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: timedOut, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error("timed out")), ms);
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Rejection code of a failed matchmake, as the browser client reads it. */
function refusalOf(error: unknown): string {
  return error instanceof MatchMakeError ? matchmakeRefusal(error).code : "INTERNAL";
}

class RoomGroup {
  readonly plan: RoomPlan;
  readonly clients: RoomClient[];
  code: string | null = null;
  game = 0;
  failed = false;
  restarting = false;
  startedAt: number | null = null;
  #startSent = false;
  #roundTimers: (() => void)[] = [];

  constructor(plan: RoomPlan) {
    this.plan = plan;
    this.clients = Array.from(
      { length: config.profile.playersPerRoom },
      (_, index) => new RoomClient(this, index),
    );
  }

  /** The ramp: create now, and bring the other Guests in over their delays. */
  async begin(): Promise<void> {
    await this.createRound(true);
  }

  async createRound(first: boolean): Promise<void> {
    if (stopped || this.failed) return;
    this.startedAt = null;
    this.#startSent = false;
    const creator = this.clients[0];
    if (!creator) return;
    const created = await creator.createRoom();
    if (!created) {
      this.failed = true;
      stats.errors.push(`room ${this.plan.index}: the creator could not create a Room`);
      return;
    }
    stats.roomsStarted += 1;
    this.code = creator.code;
    for (let index = 1; index < this.clients.length; index++) {
      const client = this.clients[index];
      if (!client) continue;
      const delay = first ? (this.plan.joinDelaysMs[index - 1] ?? 0) : 0;
      this.#roundTimers.push(
        later(delay, () => {
          void client.joinRoom();
        }),
      );
    }
  }

  /** The creator may start once every Seat is taken (R5). */
  startWhenFull(lobby: LobbyMessage): void {
    if (this.#startSent || lobby.seats.length < lobby.settings.maxPlayers) return;
    this.#startSent = true;
    this.clients[0]?.send({ type: "Start" });
  }

  startRefused(): void {
    this.#startSent = false;
  }

  /** The first `game` message of a round: schedule this game's drops. */
  onGameStart(now: number): void {
    if (this.startedAt !== null) return;
    this.startedAt = now;
    const plan = dropPlanForGame(
      seededRandom(gameSeed(config.profile.seed, this.plan.index, this.game)),
      config.profile,
    );
    for (const drop of plan) {
      const client = this.clients[drop.player];
      if (client) client.scheduleDrop(drop, now);
    }
  }

  /** The view says the game is over: leave and start a new Room at once. */
  onGameOver(): void {
    if (this.restarting || stopped) return;
    this.restarting = true;
    stats.gamesFinished += 1;
    for (const timer of this.#roundTimers.splice(0)) timer();
    for (const client of this.clients) client.cancelAll();
    void (async () => {
      await Promise.all(this.clients.map((client) => client.leave()));
      this.restarting = false;
      this.game += 1;
      if (Date.now() < config.stopAtMs) await this.createRound(false);
    })();
  }

  /** The Room is gone (server shutdown, ended game): leave and come back. */
  restartSoon(): void {
    if (this.restarting || stopped) return;
    this.restarting = true;
    for (const client of this.clients) client.cancelAll();
    void (async () => {
      await Promise.all(this.clients.map((client) => client.leave()));
      this.restarting = false;
      this.game += 1;
      if (Date.now() < config.stopAtMs) await this.createRound(false);
    })();
  }

  /** Who must come back into their Seat after the kill. */
  markAtKill(): void {
    if (this.failed || this.restarting) return;
    const joined = this.clients.filter((client) => client.hasJoined);
    if (joined.length === 0) return;
    for (const client of joined) client.expectBack = true;
    stats.clientsAtKill += joined.length;
    stats.roomsAtKill += 1;
  }

  cancel(): void {
    for (const timer of this.#roundTimers.splice(0)) timer();
    for (const client of this.clients) client.cancelAll();
  }
}

class RoomClient {
  readonly group: RoomGroup;
  readonly index: number;
  readonly guestToken = randomBytes(16).toString("hex");
  code: string | null = null;
  playerId: string | null = null;
  room: Room | null = null;
  token: string | null = null;
  hasJoined = false;
  expectBack = false;
  backAt: number | null = null;
  lastVersion = -1;
  lastView: GameMessage["view"] | null = null;
  intentSentAt: number | null = null;
  away = false;
  plannedDrop = false;
  #actionKey: string | null = null;
  #decidedTurn = -1;
  #timeoutTurn: number | null = null;
  #cancelAction: (() => void) | null = null;
  #cancelDrop: (() => void) | null = null;
  #intentional = false;

  constructor(group: RoomGroup, index: number) {
    this.group = group;
    this.index = index;
  }

  async createRoom(): Promise<boolean> {
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (stopped) return false;
      try {
        const options: CreateOptions = {
          maxPlayers: config.profile.playersPerRoom,
          minuteLimit: config.profile.minuteLimit,
          guestToken: this.guestToken,
          ...(this.group.plan.password ? { password: config.password } : {}),
        };
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
        const room = await withTimeout(sdk.create(GAME_ROOM, options), 10_000);
        this.attach(room);
        return true;
      } catch (error) {
        if (attempt === 10) stats.errors.push(`create failed: ${errorText(error)}`);
        // oxlint-disable-next-line no-await-in-loop -- wait before the next attempt
        await sleep(1_000);
      }
    }
    return false;
  }

  async joinRoom(): Promise<boolean> {
    const code = this.group.code;
    if (code === null || stopped) return false;
    for (let attempt = 1; attempt <= 30; attempt++) {
      if (stopped) return false;
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
        const room = await withTimeout(
          sdk.joinById(code, {
            code,
            guestToken: this.guestToken,
            ...(this.group.plan.password ? { password: config.password } : {}),
          }),
          10_000,
        );
        this.attach(room);
        return true;
      } catch (error) {
        if (attempt === 30) stats.errors.push(`join ${code} failed: ${errorText(error)}`);
        // oxlint-disable-next-line no-await-in-loop -- wait before the next attempt
        await sleep(500);
      }
    }
    return false;
  }

  attach(room: Room): void {
    this.room = room;
    this.code = room.roomId;
    this.token = room.reconnectionToken;
    this.hasJoined = true;
    this.away = false;
    room.reconnection.enabled = false;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage(MESSAGE.welcome, (message: WelcomeMessage) => {
      if (this.room !== room) return;
      if (this.playerId !== null && message.playerId !== this.playerId) {
        stats.seatMismatches += 1;
      }
      this.playerId = message.playerId;
    });
    room.onMessage(MESSAGE.lobby, (message: LobbyMessage) => {
      if (this.room !== room || this.index !== 0) return;
      this.group.startWhenFull(message);
    });
    room.onMessage(MESSAGE.game, (message: GameMessage) => {
      if (this.room === room) this.onGame(message);
    });
    room.onMessage(MESSAGE.rejected, (message: RejectionMessage) => {
      if (this.room !== room) return;
      stats.rejections[message.code] = (stats.rejections[message.code] ?? 0) + 1;
      if (message.code === "NOT_OFFERED") this.group.startRefused();
    });
    room.onLeave((code) => {
      if (this.room === room) this.onLeave(code);
    });
    room.onError(() => {});
    if (this.backAt === null && this.expectBack && readyAtMs !== null) this.backAt = Date.now();
  }

  onGame(message: GameMessage): void {
    const view = message.view;
    if (view.version < this.lastVersion) {
      stats.versionRegressions += 1;
      return;
    }
    const previous = this.lastVersion;
    this.lastVersion = view.version;
    this.lastView = view;
    if (this.intentSentAt !== null && view.version > previous) {
      stats.rttMs.push(Date.now() - this.intentSentAt);
      stats.intentsAccepted += 1;
      this.intentSentAt = null;
    }
    this.group.onGameStart(Date.now());
    if (isGameOver(view)) {
      this.group.onGameOver();
      return;
    }
    this.act(view);
  }

  /** Schedule one decision per offered view, after 1–5 s; 5% of this Player's Turns time out. */
  act(view: GameMessage["view"]): void {
    const me = this.playerId;
    if (me === null || this.away || stopped || view.currentPlayer !== me) return;
    // Decide once per Turn, not once per decision, so the profile's 5% is the share of Turns.
    if (this.#decidedTurn !== view.turn) {
      this.#decidedTurn = view.turn;
      this.#timeoutTurn = Math.random() < config.profile.timeoutRate ? view.turn : null;
      if (this.#timeoutTurn !== null) stats.timeouts += 1;
    }
    if (this.#timeoutTurn === view.turn) return;
    const key = `${view.turn}:${view.phase.kind}:${view.version}`;
    if (this.#actionKey === key) return;
    this.#cancelAction?.();
    this.#actionKey = key;
    if (offeredIntents(view, me).length === 0) return;
    stats.decisions += 1;
    this.#cancelAction = later(inRange(config.profile.actionDelayMs), () => {
      if (this.away || this.lastView?.version !== view.version) return;
      const intent = chooseIntent(view, me, Math.random);
      if (intent !== null) this.send(intent);
    });
  }

  send(intent: ClientIntent): void {
    if (this.room === null || !this.room.connection.isOpen || this.away) return;
    this.room.send(MESSAGE.intent, intent);
    // A Start is a Room action, not a decision round trip: only Player intents are timed.
    if (intent.type !== "Start") {
      stats.intentsSent += 1;
      this.intentSentAt = Date.now();
    }
  }

  /** A planned 10%-per-game drop: close abruptly, come back by token (or Guest token when long). */
  scheduleDrop(drop: DropPlan, gameStart: number): void {
    this.#cancelDrop?.();
    if (Date.now() + drop.atMs >= config.stopAtMs) return;
    this.#cancelDrop = later(gameStart + drop.atMs - Date.now(), () => {
      if (this.away || stopped || this.group.restarting) return;
      this.away = true;
      this.plannedDrop = true;
      this.cancelAction();
      stats.drops += 1;
      if (drop.long) stats.longDrops += 1;
      else stats.shortDrops += 1;
      this.room?.connection.close();
      void (async () => {
        await sleep(drop.returnMs);
        if (stopped) return;
        this.plannedDrop = false;
        if (drop.long) await this.rejoinByGuest();
        else if (!(await this.reconnectByToken())) await this.rejoinByGuest();
      })();
    });
  }

  /** The socket closed without us asking. */
  onLeave(code: number): void {
    this.room = null;
    if (stopped || this.#intentional || this.plannedDrop || this.group.restarting) return;
    if (code === CLOSE_CODE.seatTaken) {
      // Another connection took the Seat: the browser client gives up, and so do we.
      stats.seatMismatches += 1;
      return;
    }
    if (code === CloseCode.CONSENTED) {
      // The Room is gone (ended or deleted): a new game starts at once.
      this.group.restartSoon();
      return;
    }
    if (killAtMs !== null && Date.now() - killAtMs < RESTART_GRACE_MS) {
      // The planned SIGKILL: the browser client's own path, token then Guest token.
      void this.recover();
      return;
    }
    stats.unplannedExits += 1;
    void this.recover();
  }

  /** The browser client's reconnect order: the reconnection token, then the Guest token. */
  async recover(): Promise<void> {
    if (!(await this.reconnectByToken())) await this.rejoinByGuest();
  }

  /** The browser's quick reconnects: 8 token attempts with the shared back-off. */
  async reconnectByToken(): Promise<boolean> {
    if (this.token === null) return false;
    for (let attempt = 1; attempt <= RECONNECT.sdkRetries; attempt++) {
      if (stopped) return false;
      // oxlint-disable-next-line no-await-in-loop -- the browser's back-off between attempts
      await sleep(backoffDelay(attempt, RECONNECT.sdk.baseMs, RECONNECT.sdk.maxMs));
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
        const room = await withTimeout(sdk.reconnect(this.token), 5_000);
        this.attach(room);
        stats.tokenRejoins += 1;
        return true;
      } catch {
        // The server may still be down: next attempt, then the Guest token.
      }
    }
    return false;
  }

  /** The browser's fallback: the Guest token, with the shared back-off and the same give-up rules. */
  async rejoinByGuest(): Promise<boolean> {
    if (this.code === null) {
      stats.failedRejoins += 1;
      return false;
    }
    let notFound = 0;
    for (let attempt = 1; attempt <= 60; attempt++) {
      if (stopped) return false;
      // oxlint-disable-next-line no-await-in-loop -- the browser's back-off between attempts
      await sleep(backoffDelay(attempt, RECONNECT.guest.baseMs, RECONNECT.guest.maxMs));
      try {
        // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design
        const room = await withTimeout(
          sdk.joinById(this.code, {
            code: this.code,
            guestToken: this.guestToken,
            ...(this.group.plan.password ? { password: config.password } : {}),
          }),
          5_000,
        );
        this.attach(room);
        stats.guestRejoins += 1;
        return true;
      } catch (error) {
        const code = refusalOf(error);
        if (code === "ROOM_NOT_FOUND") {
          notFound += 1;
          if (notFound >= RECONNECT.notFoundTries) break;
        } else if (code !== "INTERNAL" && code !== "SERVER_BUSY" && code !== "RATE_LIMITED") {
          break;
        }
      }
    }
    stats.failedRejoins += 1;
    return false;
  }

  cancelAction(): void {
    this.#cancelAction?.();
    this.#cancelAction = null;
  }

  cancelAll(): void {
    this.cancelAction();
    this.#cancelDrop?.();
    this.#cancelDrop = null;
  }

  async leave(): Promise<void> {
    this.#intentional = true;
    this.cancelAll();
    const room = this.room;
    this.room = null;
    if (room?.connection.isOpen) {
      await withTimeout(room.leave(), 3_000).catch(() => {});
    }
  }
}

class LobbyWatcher {
  room: Room | null = null;
  #stopped = false;

  async join(attempt = 1): Promise<void> {
    if (this.#stopped || stopped) return;
    try {
      const room = await withTimeout(sdk.join(LOBBY_ROOM), 5_000);
      this.room = room;
      room.reconnection.enabled = false;
      room.onLeave(() => {
        if (this.room !== room) return;
        this.room = null;
        if (!this.#stopped && !stopped) void this.rejoin(1);
      });
    } catch {
      await this.rejoin(attempt);
    }
  }

  async rejoin(attempt: number): Promise<void> {
    if (this.#stopped || stopped) return;
    await sleep(backoffDelay(attempt, RECONNECT.guest.baseMs, RECONNECT.guest.maxMs));
    await this.join(attempt + 1);
  }

  stop(): void {
    this.#stopped = true;
    const room = this.room;
    this.room = null;
    if (room?.connection.isOpen) void withTimeout(room.leave(), 2_000).catch(() => {});
  }
}

function markKill(atMs: number): void {
  killAtMs = atMs;
  for (const group of groups) group.markAtKill();
}

function markReady(atMs: number): void {
  readyAtMs = atMs;
  for (const group of groups) {
    for (const client of group.clients) {
      if (client.expectBack && client.backAt === null && client.room !== null) {
        client.backAt = Date.now();
      }
    }
  }
}

function finishKillStats(): void {
  const ready = readyAtMs;
  if (ready === null) return;
  for (const group of groups) {
    for (const client of group.clients) {
      if (!client.expectBack || client.backAt === null) continue;
      if (client.backAt - ready <= RESEAT_WINDOW_MS) stats.clientsBackInTime += 1;
      stats.maxRejoinAfterReadyMs = Math.max(
        stats.maxRejoinAfterReadyMs ?? 0,
        Math.max(0, client.backAt - ready),
      );
    }
  }
}

function cpuSample(): void {
  const now = Date.now();
  const usage = process.cpuUsage(cpuLast);
  const seconds = (usage.user + usage.system) / 1_000_000;
  stats.cpuSamples.push({ at: now, seconds });
  cpuLast = process.cpuUsage();
}

async function start(config_: WorkerConfig): Promise<void> {
  config = config_;
  sdk = new Client(config.endpoint);
  const offset = config.runStartMs - Date.now();
  for (const plan of config.rooms) {
    const group = new RoomGroup(plan);
    groups.push(group);
    const at = offset + plan.startAtMs;
    if (Date.now() + at < config.stopAtMs) later(at, () => void group.begin());
  }
  for (let index = 0; index < config.watchers; index++) {
    const watcher = new LobbyWatcher();
    watchers.push(watcher);
    const at = offset + (index / Math.max(1, config.watchers)) * config.profile.rampSeconds * 1_000;
    later(at, () => void watcher.join());
  }
  cpuLast = process.cpuUsage();
  setInterval(cpuSample, 5_000);
  setInterval(() => {
    const message: WorkerToMain = {
      type: "progress",
      atMs: Date.now(),
      roomsStarted: stats.roomsStarted,
      intentsSent: stats.intentsSent,
    };
    post(message);
  }, 10_000);
}

function stopWorker(): void {
  if (stopped) return;
  stopped = true;
  cpuSample();
  for (const group of groups) {
    group.cancel();
    for (const client of group.clients) {
      void client.leave();
    }
  }
  for (const watcher of watchers) watcher.stop();
  finishKillStats();
  const message: WorkerToMain = { type: "done", stats };
  post(message);
  // Let the leave messages flush, then end the thread even if a timer lingers.
  setTimeout(() => process.exit(0), 100);
}

port.on("message", (message: MainToWorker) => {
  switch (message.type) {
    case "start":
      void start(message.config);
      break;
    case "kill":
      markKill(message.atMs);
      break;
    case "ready":
      markReady(message.atMs);
      break;
    case "snapshot": {
      const snapshotMessage: WorkerToMain = {
        type: "snapshot",
        atMs: Date.now(),
        stats: cloneStats(),
      };
      post(snapshotMessage);
      stats.rttMs = [];
      break;
    }
    case "stop":
      stopWorker();
      break;
  }
});

/** A copy for `postMessage`, without the large RTT array (drained after a snapshot). */
function cloneStats(): WorkerStats {
  return { ...stats, rttMs: [...stats.rttMs], rejections: { ...stats.rejections } };
}
