/**
 * The factory's heartbeat: one `factory-tick.yml` run ticks every ten minutes
 * for about 5.5 hours, then dispatches its successor and exits. GitHub's cron
 * is only the safety net: a run that finds another heartbeat queued or running
 * exits without ticking, and the relay keeps exactly one chain alive.
 *
 * Pure: the clock, the wait and the relay are injected, so the test moves a
 * fake clock instead of sleeping and records the relay instead of dispatching.
 * A failed tick is collected and the loop continues; the hand-over still
 * happens, so one bad tick never leaves the factory without a heartbeat.
 */

/** How often a heartbeat ticks; the cron's own period is the same. */
export const TICK_INTERVAL_MS = 10 * 60 * 1000;

/** GitHub's job limit. A heartbeat that reaches it is killed without relaying. */
export const JOB_LIMIT_MS = 6 * 60 * 60 * 1000;

/** The loop's length: 33 ticks, then the hand-over, with 30 minutes to spare. */
export const HEARTBEAT_LENGTH_MS = 5.5 * 60 * 60 * 1000;

/** The runs API's live statuses; a completed run holds nothing. */
const LIVE_STATUSES = new Set(["queued", "in_progress"]);

/** A tick run as the runs API reports it. */
export interface LiveRun {
  readonly id: number;
  readonly status: string;
}

/** What one tick reports back; `runTick`'s outcome fits, and a test can fake it. */
export interface TickResult {
  readonly errors: readonly string[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The other heartbeat that makes this start a duplicate: a queued or
 * in-progress tick run that is not this one.
 */
export const liveHeartbeat = (runs: readonly LiveRun[], selfId: number): LiveRun | undefined =>
  runs.find((run) => run.id !== selfId && LIVE_STATUSES.has(run.status));

export interface HeartbeatWindow {
  /** The ticks, the first at `start` and the rest one interval apart. */
  readonly ticks: readonly Date[];
  /** When the heartbeat stops ticking and hands over to its successor. */
  readonly handoverAt: Date;
}

/** One heartbeat's ticks and its hand-over, all measured from `start`. */
export const heartbeatWindow = (start: Date): HeartbeatWindow => {
  const ticks: Date[] = [];
  for (let offset = 0; offset < HEARTBEAT_LENGTH_MS; offset += TICK_INTERVAL_MS) {
    ticks.push(new Date(start.getTime() + offset));
  }
  return { ticks, handoverAt: new Date(start.getTime() + HEARTBEAT_LENGTH_MS) };
};

export interface HeartbeatDeps {
  readonly now: () => Date;
  /** Waits `ms`; a test advances its fake clock instead. */
  readonly sleep: (ms: number) => Promise<void>;
  /** True when another heartbeat is queued or running: this run exits. */
  readonly live: () => boolean;
  readonly tick: (now: Date) => TickResult;
  /** Dispatches the successor; throws when the dispatch fails. */
  readonly relay: () => void;
  readonly log: (line: string) => void;
}

export interface HeartbeatOutcome {
  /** Another heartbeat was alive, so this run ticked nothing. */
  readonly duplicate: boolean;
  /** The ticks attempted, including the failed ones. */
  readonly ticks: number;
  readonly relayed: boolean;
  /** One line per failed tick and a failed relay; the caller fails the run with them. */
  readonly errors: readonly string[];
}

/** The one wait helper: a tick time already passed needs no sleep. */
const wait = async (ms: number, sleep: (ms: number) => Promise<void>): Promise<void> => {
  if (ms > 0) await sleep(ms);
};

/**
 * One heartbeat: exit if another is alive, tick every ten minutes until the
 * hand-over, then relay the successor. A tick that throws or reports errors is
 * collected, logged and followed by the next tick.
 */
export const runHeartbeat = async ({
  now,
  sleep,
  live,
  tick,
  relay,
  log,
}: HeartbeatDeps): Promise<HeartbeatOutcome> => {
  if (live()) {
    log("Another heartbeat is queued or running; this run exits without ticking.");
    return { duplicate: true, ticks: 0, relayed: false, errors: [] };
  }

  const window = heartbeatWindow(now());
  const errors: string[] = [];
  let ticks = 0;

  for (const at of window.ticks) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the ticks are one heartbeat: one at a time, ten minutes apart
    await wait(at.getTime() - now().getTime(), sleep);
    ticks += 1;
    try {
      const { errors: tickErrors } = tick(now());
      for (const error of tickErrors) log(`Tick error: ${error}`);
      errors.push(...tickErrors);
    } catch (error) {
      const message = `tick at ${at.toISOString()} failed: ${messageOf(error)}`;
      log(message);
      errors.push(message);
    }
  }

  await wait(window.handoverAt.getTime() - now().getTime(), sleep);

  let relayed = false;
  try {
    relay();
    relayed = true;
    log(`Handed over to the next heartbeat at ${window.handoverAt.toISOString()}.`);
  } catch (error) {
    errors.push(`could not relay the next heartbeat: ${messageOf(error)}`);
  }

  return { duplicate: false, ticks, relayed, errors };
};
